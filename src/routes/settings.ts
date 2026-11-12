import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'

export function settingsRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const [characters, connections, refresh] = await Promise.all([
      scope.db.prepare('SELECT id,name,state FROM characters WHERE workspace_id=? ORDER BY name').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,status,created_at AS createdAt FROM tumblr_connections WHERE workspace_id=? ORDER BY created_at DESC').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT MAX(last_refresh_at) AS lastSuccessfulSync, MAX(refresh_error) AS latestError FROM reply_branches WHERE workspace_id=?').bind(scope.workspaceId).first(),
    ])
    const invites = scope.role === 'owner' ? await scope.db.prepare('SELECT id,email,kind,expires_at AS expiresAt FROM invites WHERE workspace_id=? AND accepted_at IS NULL ORDER BY expires_at DESC').bind(scope.workspaceId).all() : { results:[] }
    return c.json({ workspaceId:scope.workspaceId, role: scope.role, characters:characters.results, connections:connections.results, invites:invites.results, lastSuccessfulSync: refresh?.lastSuccessfulSync ?? null, latestError:refresh?.latestError ?? null })
  })
  app.patch('/characters/:id/hiatus', async c => {
    const scope=await requireWorkspace(c); const { hiatus }=await c.req.json<{hiatus?:boolean}>()
    if (typeof hiatus !== 'boolean') throw new HTTPException(400,{message:'Invalid request body'})
    const row=await scope.db.prepare('UPDATE characters SET state=? WHERE workspace_id=? AND id=? RETURNING id,name,state').bind(hiatus?'hiatus':'active',scope.workspaceId,c.req.param('id')).first()
    if(!row) throw new HTTPException(404,{message:'Character not found'}); return c.json(row)
  })
  return app
}
