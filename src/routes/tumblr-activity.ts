import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createTumblrClient, type TumblrNotification, type TumblrPost } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'

type ConnectedBlog = { tokenEncrypted: string; tokenSecretEncrypted: string; blogIdentifier: string }

export function tumblrActivityRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/unread-count', async c => { const scope=await requireWorkspace(c); const row=await scope.db.prepare('SELECT count(*) AS count FROM activity_notification_deliveries WHERE workspace_id=? AND seen_at IS NULL').bind(scope.workspaceId).first<{count:number}>(); return c.json({count:row?.count??0}) })
  app.post('/mark-seen', async c => { const scope=await requireWorkspace(c); await scope.db.prepare('UPDATE activity_notification_deliveries SET seen_at=? WHERE workspace_id=? AND seen_at IS NULL').bind(new Date().toISOString(),scope.workspaceId).run(); return c.body(null,204) })

  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const rows = await scope.db.prepare(`
      SELECT tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted,
        cb.blog_identifier AS blogIdentifier
      FROM tumblr_connections tc
      JOIN character_blogs cb ON cb.workspace_id = tc.workspace_id AND cb.tumblr_connection_id = tc.id
      WHERE tc.workspace_id = ? AND tc.status = 'active'
    `).bind(scope.workspaceId).all<ConnectedBlog>()
    const tracked = await scope.db.prepare(`
      SELECT root_blog_id AS blogIdentifier, root_post_id AS postId, thread_root_id AS threadRootId FROM starters WHERE workspace_id = ?
      UNION
      SELECT last_poster AS blogIdentifier, latest_post_id AS postId, latest_post_id AS threadRootId FROM reply_branches WHERE workspace_id = ? AND latest_post_id IS NOT NULL AND last_poster IS NOT NULL
    `).bind(scope.workspaceId, scope.workspaceId).all<{ blogIdentifier: string; postId: string; threadRootId:string }>()
    const trackedPosts = new Set(tracked.results.map(row => `${row.blogIdentifier.toLowerCase()}:${row.postId}`))
    const trackedThreadRoots = new Set(tracked.results.map(row => row.threadRootId))
    const dismissed = await scope.db.prepare(`
      SELECT blog_identifier AS blogIdentifier, post_id AS postId
      FROM activity_dismissals WHERE workspace_id = ?
    `).bind(scope.workspaceId).all<{ blogIdentifier: string; postId: string }>()
    const dismissedPosts = new Set(dismissed.results.map(row => `${row.blogIdentifier.toLowerCase()}:${row.postId}`))
    const responses = await Promise.all(rows.results.map(async row => {
      const client = createTumblrClient({ consumerKey: c.env.TUMBLR_CONSUMER_KEY, consumerSecret: c.env.TUMBLR_CONSUMER_SECRET, token: await decryptToken(row.tokenEncrypted, c.env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(row.tokenSecretEncrypted, c.env.TOKEN_ENCRYPTION_KEY) })
      try {
        const notifications = await client.getNotifications(row.blogIdentifier)
        const enriched = await Promise.all(notifications.map(async notification => {
          if (notification.preview || !notification.postId || notification.actor === 'anonymous') return notification
          try {
            const post = await client.getPost(notification.actor, notification.postId)
            return { ...notification, preview: post.preview ?? post.title ?? null, sourceUrl: notification.sourceUrl ?? post.postUrl ?? null, rootPostId:post.rootPostId }
          } catch { return notification }
        }))
        return { notifications: enriched, recentPosts: await client.getRecentPosts(row.blogIdentifier), error: null }
      } catch (error) {
        return { notifications: [] as TumblrNotification[], recentPosts: [] as TumblrPost[], error: `${row.blogIdentifier}: ${error instanceof Error ? error.message : 'Tumblr activity request failed'}` }
      }
    }))
    const diagnostics = responses.flatMap(response => response.error ? [response.error] : [])
    const notifications = responses.flatMap(response => response.notifications)
      .filter(notification => !('rootPostId' in notification) || !notification.rootPostId || !trackedThreadRoots.has(notification.rootPostId))
      .filter((notification, index, all) => all.findIndex(other => other.type === notification.type && other.actor === notification.actor && other.postId === notification.postId) === index)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const mentionTypes = new Set(['mention', 'mention_in_post', 'mention_in_reply', 'user_mention', 'note_mention'])
    const threadCandidates = responses.flatMap(response => response.recentPosts)
      .filter(post => !trackedPosts.has(`${post.blogIdentifier.toLowerCase()}:${post.id}`) && !trackedThreadRoots.has(post.rootPostId) && !dismissedPosts.has(`${post.blogIdentifier.toLowerCase()}:${post.id}`))
      .map(post => ({ id: `post:${post.blogIdentifier}:${post.id}`, blogIdentifier: post.blogIdentifier, actor: post.blogIdentifier, timestamp: new Date().toISOString(), postId: post.id, preview: post.preview ?? post.title ?? null, sourceUrl: post.postUrl ?? `https://www.tumblr.com/${post.blogIdentifier.replace(/\.tumblr\.com$/i, '')}/${post.id}` }))
      .slice(0, 12)
    return c.json({ asks: notifications.filter(notification => notification.type === 'ask'), mentions: notifications.filter(notification => mentionTypes.has(notification.type)), threadCandidates, diagnostics })
  })
  app.post('/dismissals', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ blogIdentifier: z.string().min(1).max(255), postId: z.string().min(1).max(255) }).parse(await c.req.json())
    await scope.db.prepare(`
      INSERT INTO activity_dismissals (workspace_id, blog_identifier, post_id, dismissed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, blog_identifier, post_id) DO NOTHING
    `).bind(scope.workspaceId, body.blogIdentifier.toLowerCase(), body.postId, new Date().toISOString()).run()
    return c.json({ ok: true })
  })
  return app
}
