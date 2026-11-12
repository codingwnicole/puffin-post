import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { canonicalBlogIdentifier } from '../tumblr/normalize'

export function connectionRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const rows = await scope.db.prepare('SELECT id,status,created_at AS createdAt FROM tumblr_connections WHERE workspace_id=? ORDER BY created_at DESC').bind(scope.workspaceId).all()
    return c.json(rows.results)
  })
  app.post('/:connectionId/blogs', async c => {
    const scope = await requireWorkspace(c)
    const input = await c.req.json<{ characterId?:string; blogIdentifier?:string; displayLabel?:string }>()
    if (!input.characterId || !input.blogIdentifier || !input.displayLabel) return c.json({ error:'Invalid request body' },400)
    const connection = await scope.db.prepare('SELECT id FROM tumblr_connections WHERE workspace_id=? AND id=?').bind(scope.workspaceId,c.req.param('connectionId')).first()
    const character = await scope.db.prepare('SELECT id FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,input.characterId).first()
    if (!connection || !character) return c.json({ error:'Connection or character not found' },404)
    const id = crypto.randomUUID()
    await scope.db.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)')
      .bind(id,scope.workspaceId,input.characterId,c.req.param('connectionId'),canonicalBlogIdentifier(input.blogIdentifier),input.displayLabel.trim()).run()
    return c.json({ id, characterId: input.characterId, connectionId:c.req.param('connectionId'), blogIdentifier:canonicalBlogIdentifier(input.blogIdentifier), displayLabel:input.displayLabel.trim() },201)
  })
  return app
}
