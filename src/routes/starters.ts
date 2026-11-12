import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createStarter, getStarter } from '../db/repositories/starters'
import { createReplyBranch, listInboxBranches } from '../db/repositories/branches'
import { branchSchema, starterSchema } from './tracking-validation'

export function starterRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/options', async c => {
    const scope = await requireWorkspace(c)
    const [characters,partners] = await Promise.all([
      scope.db.prepare('SELECT id,name FROM characters WHERE workspace_id=? ORDER BY name').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,display_label AS name FROM partners WHERE workspace_id=? ORDER BY display_label').bind(scope.workspaceId).all(),
    ])
    return c.json({ characters: characters.results, partners: partners.results })
  })
  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await createStarter({ ...scope,...starterSchema.parse(await c.req.json()) }),201)
  })
  app.get('/:starterId', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('starterId')
    return c.json({ starter: await getStarter(scope,id), branches: await listInboxBranches({ ...scope,starterId:id,includeArchived:true }) })
  })
  app.post('/:starterId/branches', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await createReplyBranch({ ...scope,starterId:c.req.param('starterId'),...branchSchema.parse(await c.req.json()) }),201)
  })
  return app
}
