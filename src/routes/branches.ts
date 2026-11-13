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
  app.post('/branches/:branchId/archive', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await updateReplyBranch(scope, c.req.param('branchId'), { status: 'archived' }))
  })
  app.post('/branches/:branchId/restore', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await updateReplyBranch(scope, c.req.param('branchId'), { status: 'queued' }))
  })
  app.get('/inbox', async c => {
    const scope = await requireWorkspace(c)
    const status = z.enum(['your_turn','their_turn','queued','archived']).optional().parse(c.req.query('status'))
    const characterId=z.string().max(100).optional().parse(c.req.query('characterId'))
    const tagId=z.string().max(100).optional().parse(c.req.query('tagId'))
    const q=z.string().max(300).optional().parse(c.req.query('q'))
    const doNext=z.enum(['true','false']).optional().parse(c.req.query('doNext')) === 'true'
    const oldestFirst=doNext||z.enum(['true','false']).optional().parse(c.req.query('oldestFirst')) === 'true'
    const [branches,owed] = await Promise.all([listInboxBranches({ ...scope,status:doNext?'your_turn':status,characterId,tagId,q,oldestFirst }),listInboxBranches({ ...scope,status:'your_turn' })])
    const overdueDrafts=await scope.db.prepare("SELECT count(*) AS count FROM reply_drafts WHERE workspace_id=? AND state='open' AND reminder_at IS NOT NULL AND reminder_at<=?").bind(scope.workspaceId,new Date().toISOString()).first<{count:number}>()
    const dueSoon=await scope.db.prepare("SELECT count(*) AS count FROM reply_branches WHERE workspace_id=? AND next_check_at IS NOT NULL AND next_check_at<=?").bind(scope.workspaceId,new Date(Date.now()+7*86400000).toISOString()).first<{count:number}>()
    return c.json({ branches,yourTurnCount:owed.length,overdueDraftCount:overdueDrafts?.count ?? 0,dueSoonCount:dueSoon?.count ?? 0 })
  })
  return app
}
