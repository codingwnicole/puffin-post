import type { Env } from '../worker'
import { createTumblrClient, type TumblrActivity } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'
import { canonicalBlogIdentifier } from '../tumblr/normalize'
import { rotateAfter } from './cursor'
import { refreshStarterBranches, type RefreshBranch } from '../tumblr/refresh'
import { sendWorkspacePush } from '../routes/push'

export interface RefreshBatchResult { selected: number; refreshed: number; failed: number }
interface RefreshTarget { id:string; workspaceId:string; characterId:string; blogIdentifier:string; tokenEncrypted:string; tokenSecretEncrypted:string }

export async function runRefreshBatch(env: Env, now: Date, limit: number): Promise<RefreshBatchResult> {
  const state = await env.DB.prepare('SELECT last_character_blog_id AS lastCharacterBlogId FROM refresh_scheduler_state WHERE id=1').first<{lastCharacterBlogId:string|null}>()
  const candidates = await env.DB.prepare(`SELECT cb.id, cb.workspace_id AS workspaceId, cb.character_id AS characterId, cb.blog_identifier AS blogIdentifier,
      tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted
    FROM character_blogs cb JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
    JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
    WHERE c.state='active' AND tc.status='active' ORDER BY cb.id`).all<RefreshTarget>()
  const selected = rotateAfter(candidates.results, state?.lastCharacterBlogId ?? null, limit)
  let refreshed = 0, failed = 0
  for (const target of selected) {
    try {
      const client = createTumblrClient({ consumerKey:env.TUMBLR_CONSUMER_KEY, consumerSecret:env.TUMBLR_CONSUMER_SECRET,
        token:await decryptToken(target.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY), tokenSecret:await decryptToken(target.tokenSecretEncrypted, env.TOKEN_ENCRYPTION_KEY) })
      const ownBlogs = await env.DB.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(target.workspaceId,target.characterId).all<{blogIdentifier:string}>()
      try {
        const mentions = (await client.getNotifications(target.blogIdentifier)).filter(item => ['mention','mention_in_post','mention_in_reply','user_mention','note_mention'].includes(item.type))
        for (const mention of mentions) {
          const key = `mention:${target.blogIdentifier}:${mention.id}`
          const saved = await env.DB.prepare('INSERT INTO activity_notification_deliveries (workspace_id,notification_key,created_at) VALUES (?,?,?) ON CONFLICT(workspace_id,notification_key) DO NOTHING').bind(target.workspaceId,key,now.toISOString()).run()
          if (saved.meta.changes) await sendWorkspacePush(env,target.workspaceId,{title:'Puffin Post',body:`${mention.actor === 'anonymous' ? 'Someone' : mention.actor.replace(/\.tumblr\.com$/i,'')} tagged one of your blogs.`,url:'/#activity'})
        }
      } catch { /* Activity notifications are optional; thread refresh must still succeed. */ }
      const starters = await env.DB.prepare('SELECT id,root_post_id AS rootPostId,root_blog_id AS rootBlogId FROM starters WHERE workspace_id=? AND archived=0 AND character_id=(SELECT character_id FROM character_blogs WHERE workspace_id=? AND id=?)')
        .bind(target.workspaceId,target.workspaceId,target.id).all<{id:string;rootPostId:string;rootBlogId:string}>()
      for (const starter of starters.results) {
        const rows = await env.DB.prepare(`SELECT b.id,b.latest_post_id AS latestPostId,b.status,b.status_manual_override_at AS statusManualOverrideAt,p.blog_identifier AS partnerBlogIdentifier
          FROM reply_branches b LEFT JOIN partners p ON p.workspace_id=b.workspace_id AND p.id=b.partner_id
          WHERE b.workspace_id=? AND b.starter_id=? AND b.archived_at IS NULL`).bind(target.workspaceId,starter.id).all<RefreshBranch>()
        const activities = await client.getThreadActivity(canonicalBlogIdentifier(starter.rootBlogId), starter.rootPostId)
        await refreshStarterBranches({ workspaceId:target.workspaceId, starterId:starter.id, rootBlogIdentifier:canonicalBlogIdentifier(starter.rootBlogId), ownBlogIdentifiers:ownBlogs.results.map(blog=>canonicalBlogIdentifier(blog.blogIdentifier)), branches:rows.results, activities, now }, async (branch, activity, status) => {
          const automaticStatus = branch.statusManualOverrideAt ? branch.status : status
          await env.DB.batch([
            env.DB.prepare(`UPDATE reply_branches SET latest_post_id=?,last_poster=?,last_activity_at=?,last_refresh_at=?,refresh_error=NULL,status=? WHERE workspace_id=? AND id=?`)
              .bind(activity.postId,activity.blogIdentifier,activity.timestamp,new Date(now).toISOString(),automaticStatus,target.workspaceId,branch.id),
            env.DB.prepare(`INSERT INTO activities (id,workspace_id,starter_id,reply_branch_id,type,actor,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
              .bind(crypto.randomUUID(),target.workspaceId,starter.id,branch.id,'tumblr_reply_detected',activity.blogIdentifier,'tumblr',JSON.stringify({postId:activity.postId}),new Date(now).toISOString()),
          ])
          if (automaticStatus === 'your_turn' && branch.status !== 'your_turn') await sendWorkspacePush(env,target.workspaceId,{title:'Puffin Post',body:'A tracked thread has a new reply waiting on you.',url:'/#inbox'})
        })
      }
      await env.DB.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_successful_refresh_at,last_error,failure_count)
        VALUES (?,?,?,?,NULL,0) ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_successful_refresh_at=excluded.last_successful_refresh_at,last_error=NULL,failure_count=0`)
        .bind(target.workspaceId,target.id,now.toISOString(),now.toISOString()).run()
      refreshed++
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0,500) : 'Tumblr refresh failed'
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_error,failure_count) VALUES (?,?,?,?,1)
          ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error,failure_count=refresh_cursors.failure_count+1`).bind(target.workspaceId,target.id,now.toISOString(),message),
        env.DB.prepare(`UPDATE reply_branches SET refresh_error=?,last_refresh_at=? WHERE workspace_id=? AND starter_id IN (SELECT id FROM starters WHERE workspace_id=? AND archived=0 AND character_id=(SELECT character_id FROM character_blogs WHERE workspace_id=? AND id=?))`)
          .bind(message,now.toISOString(),target.workspaceId,target.workspaceId,target.workspaceId,target.id),
      ])
      failed++
    }
  }
  const last = selected.at(-1)
  if (last) await env.DB.prepare(`INSERT INTO refresh_scheduler_state (id,last_character_blog_id,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET last_character_blog_id=excluded.last_character_blog_id,updated_at=excluded.updated_at`).bind(last.id,now.toISOString()).run()
  return { selected:selected.length, refreshed, failed }
}
