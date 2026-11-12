import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { listInboxBranches, updateReplyBranch } from '../db/repositories/branches'
import { branchSchema } from './tracking-validation'

export function branchRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.patch('/branches/:branchId', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await updateReplyBranch(scope,c.req.param('branchId'),branchSchema.parse(await c.req.json())))
  })
  app.get('/inbox', async c => {
    const scope = await requireWorkspace(c)
    const status = z.enum(['your_turn','their_turn','queued','archived']).optional().parse(c.req.query('status'))
    const [branches,owed] = await Promise.all([listInboxBranches({ ...scope,status }),listInboxBranches({ ...scope,status:'your_turn' })])
    return c.json({ branches,yourTurnCount:owed.length })
  })
  return app
}
