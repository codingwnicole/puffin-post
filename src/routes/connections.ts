import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { canonicalBlogIdentifier } from '../tumblr/normalize'

export function connectionRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const rows = await scope.db.prepare('SELECT id,status,created_at AS createdAt,account_metadata_json FROM tumblr_connections WHERE workspace_id=? ORDER BY created_at DESC').bind(scope.workspaceId).all<{id:string;status:string;createdAt:string;account_metadata_json:string}>()
    const assignments = await scope.db.prepare(`SELECT character_blogs.id, character_blogs.tumblr_connection_id AS connectionId, character_blogs.character_id AS characterId,
      character_blogs.blog_identifier AS blogIdentifier, character_blogs.display_label AS displayLabel, characters.name AS characterName
      FROM character_blogs JOIN characters ON characters.id=character_blogs.character_id AND characters.workspace_id=character_blogs.workspace_id
      WHERE character_blogs.workspace_id=? ORDER BY characters.name COLLATE NOCASE, character_blogs.display_label COLLATE NOCASE`).bind(scope.workspaceId).all<{id:string;connectionId:string;characterId:string;blogIdentifier:string;displayLabel:string;characterName:string}>()
    return c.json(rows.results.map(({ account_metadata_json, ...connection }) => {
      let blogs: string[] = []; try { blogs = JSON.parse(account_metadata_json).blogs ?? [] } catch { /* no assignable blogs */ }
      return { ...connection, blogs: blogs.map(canonicalBlogIdentifier), assignments: assignments.results.filter(assignment => assignment.connectionId === connection.id) }
    }))
  })
  app.post('/:connectionId/blogs', async c => {
    const scope = await requireWorkspace(c)
    const input = await c.req.json<{ characterId?:string; blogIdentifier?:string; displayLabel?:string }>()
    if (!input.characterId || !input.blogIdentifier || !input.displayLabel) return c.json({ error:'Invalid request body' },400)
    const connection = await scope.db.prepare('SELECT id,account_metadata_json FROM tumblr_connections WHERE workspace_id=? AND id=?').bind(scope.workspaceId,c.req.param('connectionId')).first<{ id:string; account_metadata_json:string }>()
    const character = await scope.db.prepare('SELECT id FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,input.characterId).first()
    if (!connection || !character) return c.json({ error:'Connection or character not found' },404)
    let blogs: string[] = []
    try { blogs = JSON.parse(connection.account_metadata_json).blogs ?? [] } catch { /* malformed legacy metadata is not assignable */ }
    const blogIdentifier = canonicalBlogIdentifier(input.blogIdentifier)
    if (!blogs.map(canonicalBlogIdentifier).includes(blogIdentifier)) return c.json({ error:'Blog is not available for this Tumblr connection' },400)
    const existing = await scope.db.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind(scope.workspaceId,input.characterId,blogIdentifier).first()
    if (existing) return c.json({ error:'This Tumblr blog is already assigned to this character.' },409)
    const id = crypto.randomUUID()
    await scope.db.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)')
      .bind(id,scope.workspaceId,input.characterId,c.req.param('connectionId'),blogIdentifier,input.displayLabel.trim()).run()
    return c.json({ id, characterId: input.characterId, connectionId:c.req.param('connectionId'), blogIdentifier, displayLabel:input.displayLabel.trim() },201)
  })
  return app
}
