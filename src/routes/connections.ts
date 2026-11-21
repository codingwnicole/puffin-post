import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { canonicalBlogIdentifier, normalizeTumblrTag } from '../tumblr/normalize'
import { blogMetadata, createTumblrClient } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'
import type { WorkspaceScope } from '../db/client'

const BLOG_LIST_MAX_AGE_MS = 10 * 60_000
/** Re-read the account's blog list (one Tumblr call, at most every 10 minutes per connection) so new
 * sideblogs become assignable without reconnecting, and follow renames by Tumblr's permanent blog id:
 * the old name is replaced in this workspace's assignments and threads. */
async function refreshBlogList(scope: WorkspaceScope, env: Env, row: { id: string; status: string; account_metadata_json: string; token: string; secret: string }, now = new Date()) {
  let meta: { blogs?: string[]; uuids?: Record<string, string>; refreshedAt?: string } = {}
  try { meta = JSON.parse(row.account_metadata_json) } catch { /* treat as never refreshed */ }
  if (row.status !== 'active' || !row.token || (meta.refreshedAt && now.getTime() - Date.parse(meta.refreshedAt) < BLOG_LIST_MAX_AGE_MS)) return row.account_metadata_json
  let next: ReturnType<typeof blogMetadata>
  try {
    const client = createTumblrClient({ consumerKey: env.TUMBLR_CONSUMER_KEY, consumerSecret: env.TUMBLR_CONSUMER_SECRET, token: await decryptToken(row.token, env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(row.secret, env.TOKEN_ENCRYPTION_KEY) })
    next = blogMetadata(await client.getBlogs(), now)
  } catch { return row.account_metadata_json } // Tumblr down or rate limited: keep the last known list.
  const writes = [scope.db.prepare('UPDATE tumblr_connections SET account_metadata_json=? WHERE workspace_id=? AND id=?').bind(JSON.stringify(next), scope.workspaceId, row.id)]
  for (const [uuid, oldName] of Object.entries(meta.uuids ?? {})) {
    const newName = next.uuids[uuid]
    if (!newName || newName === oldName) continue
    writes.push(
      scope.db.prepare('UPDATE character_blogs SET blog_identifier=?, display_label=CASE WHEN display_label=? THEN ? ELSE display_label END WHERE workspace_id=? AND tumblr_connection_id=? AND blog_identifier=?').bind(newName, oldName, newName, scope.workspaceId, row.id, oldName),
      scope.db.prepare('UPDATE starters SET root_blog_id=? WHERE workspace_id=? AND root_blog_id=?').bind(newName, scope.workspaceId, oldName),
      scope.db.prepare('UPDATE starters SET thread_root_blog_id=? WHERE workspace_id=? AND thread_root_blog_id=?').bind(newName, scope.workspaceId, oldName),
    )
  }
  await scope.db.batch(writes)
  return JSON.stringify(next)
}

export function connectionRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const rows = await scope.db.prepare('SELECT id,status,created_at AS createdAt,account_metadata_json,token_encrypted AS token,token_secret_encrypted AS secret FROM tumblr_connections WHERE workspace_id=? ORDER BY created_at DESC').bind(scope.workspaceId).all<{id:string;status:string;createdAt:string;account_metadata_json:string;token:string;secret:string}>()
    for (const row of rows.results) row.account_metadata_json = await refreshBlogList(scope, c.env, row)
    const assignments = await scope.db.prepare(`SELECT character_blogs.id, character_blogs.tumblr_connection_id AS connectionId, character_blogs.character_id AS characterId,
      character_blogs.blog_identifier AS blogIdentifier, character_blogs.display_label AS displayLabel, character_blogs.character_tag AS characterTag, characters.name AS characterName
      FROM character_blogs JOIN characters ON characters.id=character_blogs.character_id AND characters.workspace_id=character_blogs.workspace_id
      WHERE character_blogs.workspace_id=? AND characters.state != 'archived' ORDER BY characters.name COLLATE NOCASE, character_blogs.display_label COLLATE NOCASE`).bind(scope.workspaceId).all<{id:string;connectionId:string;characterId:string;blogIdentifier:string;displayLabel:string;characterName:string}>()
    return c.json(rows.results.map(({ account_metadata_json, token: _token, secret: _secret, ...connection }) => {
      let blogs: string[] = []; try { blogs = JSON.parse(account_metadata_json).blogs ?? [] } catch { /* no assignable blogs */ }
      return { ...connection, blogs: blogs.map(canonicalBlogIdentifier), assignments: assignments.results.filter(assignment => assignment.connectionId === connection.id) }
    }))
  })
  app.post('/:connectionId/blogs', async c => {
    const scope = await requireWorkspace(c)
    const input = await c.req.json<{ characterId?:string; blogIdentifier?:string; displayLabel?:string; characterTag?:string }>()
    if (!input.characterId || !input.blogIdentifier) return c.json({ error:'Invalid request body' },400)
    const connection = await scope.db.prepare('SELECT id,account_metadata_json FROM tumblr_connections WHERE workspace_id=? AND id=?').bind(scope.workspaceId,c.req.param('connectionId')).first<{ id:string; account_metadata_json:string }>()
    const character = await scope.db.prepare('SELECT id FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,input.characterId).first()
    if (!connection || !character) return c.json({ error:'Connection or character not found' },404)
    let blogs: string[] = []
    try { blogs = JSON.parse(connection.account_metadata_json).blogs ?? [] } catch { /* malformed legacy metadata is not assignable */ }
    const blogIdentifier = canonicalBlogIdentifier(input.blogIdentifier)
    const characterTag = input.characterTag?.trim() ? normalizeTumblrTag(input.characterTag) : null
    if (!blogs.map(canonicalBlogIdentifier).includes(blogIdentifier)) return c.json({ error:'Blog is not available for this Tumblr connection' },400)
    // An archived duplicate must not keep a live character from reclaiming its
    // blog. Threads remain attached to the archived character; only its future
    // Tumblr assignment is released.
    await scope.db.prepare(`DELETE FROM character_blogs
      WHERE workspace_id=? AND tumblr_connection_id=? AND blog_identifier=? AND character_id != ?
        AND character_id IN (SELECT id FROM characters WHERE workspace_id=? AND state='archived')`)
      .bind(scope.workspaceId,c.req.param('connectionId'),blogIdentifier,input.characterId,scope.workspaceId).run()
    const existing = await scope.db.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind(scope.workspaceId,input.characterId,blogIdentifier).first()
    const overlapping = await scope.db.prepare('SELECT id,character_tag AS characterTag FROM character_blogs WHERE workspace_id=? AND tumblr_connection_id=? AND blog_identifier=? AND character_id != ?').bind(scope.workspaceId,c.req.param('connectionId'),blogIdentifier,input.characterId).all<{id:string;characterTag:string|null}>()
    if ((!characterTag && overlapping.results.length) || (characterTag && overlapping.results.some(rule => !rule.characterTag || rule.characterTag === characterTag))) {
      return c.json({ error:'A shared blog needs a different character tag for each character.' },409)
    }
    // Re-save of this character's own assignment: update in place (after the shared-tag check, so a tag change can't collide).
    if (existing) {
      const displayLabel = input.displayLabel?.trim() || blogIdentifier
      await scope.db.prepare('UPDATE character_blogs SET display_label=?,character_tag=? WHERE workspace_id=? AND id=?').bind(displayLabel,characterTag,scope.workspaceId,existing.id).run()
      return c.json({ id: existing.id, characterId: input.characterId, connectionId:c.req.param('connectionId'), blogIdentifier, displayLabel, characterTag },200)
    }
    const id = crypto.randomUUID()
    const displayLabel = input.displayLabel?.trim() || blogIdentifier
    try{
      await scope.db.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label,character_tag) VALUES (?,?,?,?,?,?,?)')
        .bind(id,scope.workspaceId,input.characterId,c.req.param('connectionId'),blogIdentifier,displayLabel,characterTag).run()
    }catch(error){
      // ponytail: a concurrent save for the same character+blog lost the race to the unique index;
      // apply it like the sequential re-save path (update in place). Another character winning the blog is a 409.
      if(String((error as {message?:string}).message??'').includes('SQLITE_CONSTRAINT_UNIQUE')){
        const winner=await scope.db.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind(scope.workspaceId,input.characterId,blogIdentifier).first<{id:string}>()
        if(!winner) return c.json({ error:'A shared blog needs a different character tag for each character.' },409)
        await scope.db.prepare('UPDATE character_blogs SET display_label=?,character_tag=? WHERE workspace_id=? AND id=?').bind(displayLabel,characterTag,scope.workspaceId,winner.id).run()
        return c.json({ id:winner.id, characterId:input.characterId, connectionId:c.req.param('connectionId'), blogIdentifier, displayLabel, characterTag },200)
      }
      throw error
    }
    return c.json({ id, characterId: input.characterId, connectionId:c.req.param('connectionId'), blogIdentifier, displayLabel, characterTag },201)
  })
  app.delete('/:connectionId/blogs/:assignmentId', async c => {
    const scope = await requireWorkspace(c)
    const result = await scope.db.prepare('DELETE FROM character_blogs WHERE workspace_id=? AND tumblr_connection_id=? AND id=?').bind(scope.workspaceId,c.req.param('connectionId'),c.req.param('assignmentId')).run()
    if (!result.meta.changes) return c.json({error:'Assignment not found'},404)
    return c.body(null,204)
  })
  app.delete('/:connectionId', async c => {
    const scope=await requireWorkspace(c),connectionId=c.req.param('connectionId')
    if(!await scope.db.prepare('SELECT id FROM tumblr_connections WHERE workspace_id=? AND id=?').bind(scope.workspaceId,connectionId).first()) return c.json({error:'Tumblr account not found'},404)
    // Disconnecting stops refresh work without destroying character data.
    // Tokens are wiped, cursors reset (re-auth resumes from scratch), and the
    // runner skips 'disconnected' connections. Characters, threads, drafts,
    // and blog assignments all stay so the user's data survives a re-connect.
    await scope.db.batch([
      scope.db.prepare('UPDATE tumblr_connections SET status=\'disconnected\', token_encrypted=\'\', token_secret_encrypted=\'\', account_metadata_json=\'{}\' WHERE workspace_id=? AND id=?').bind(scope.workspaceId,connectionId),
      scope.db.prepare('UPDATE refresh_cursors SET newest_post_timestamp=NULL, newest_post_id=NULL, last_error=NULL, failure_count=0 WHERE workspace_id=? AND character_blog_id IN (SELECT id FROM character_blogs WHERE workspace_id=? AND tumblr_connection_id=?)').bind(scope.workspaceId,scope.workspaceId,connectionId),
      scope.db.prepare('DELETE FROM tumblr_oauth_states WHERE workspace_id=?').bind(scope.workspaceId),
    ])
    return c.body(null,204)
  })
  return app
}
