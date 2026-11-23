import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { checkRateLimit } from '../auth/rate-limits'
import { listInboxBranches, restoreReplyBranch, updateReplyBranch } from '../db/repositories/branches'
import { runRefreshBatch } from '../refresh/runner'
import { branchSchema } from './tracking-validation'

export function branchRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  // "Check Tumblr now": the same refresh the 30-minute cron runs, limited to the caller's workspace.
  // ponytail: one check per 2 minutes per workspace; each spends up to REFRESH_FETCH_BUDGET of Tumblr's
  // app-wide 1,000 calls/hour that every user shares. Lower the window only if Tumblr raises that limit.
  app.post('/refresh', async c => {
    const scope = await requireWorkspace(c)
    const gate = await checkRateLimit(c.env.DB, `refresh-now:${scope.workspaceId}`, 1, 2 * 60_000)
    if (!gate.allowed) throw new HTTPException(429, { message: `Tumblr was just checked. Try again in ${gate.retryAfterSeconds} seconds.` })
    const result = await runRefreshBatch(c.env, new Date(), 60, { workspaceId: scope.workspaceId })
    if (result.busy) throw new HTTPException(409, { message: 'A Tumblr check is already running. Your threads will update in a minute.' })
    if (result.rateLimited) throw new HTTPException(503, { message: 'Tumblr asked us to slow down. Your threads will update on the next automatic check.' })
    return c.json({ checked: result.refreshed, failed: result.failed })
  })
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
    return c.json(await restoreReplyBranch(scope, c.req.param('branchId')))
  })
  app.get('/inbox', async c => {
    const scope = await requireWorkspace(c)
    const archivedOnly = z.enum(['true','false']).optional().parse(c.req.query('archivedOnly')) === 'true'
    const status = archivedOnly ? undefined : z.enum(['your_turn','their_turn','queued','archived']).optional().parse(c.req.query('status'))
    const includeArchived = z.enum(['true','false']).optional().parse(c.req.query('includeArchived')) === 'true'
    const characterId=z.string().max(100).optional().parse(c.req.query('characterId'))
    const tagId=z.string().max(100).optional().parse(c.req.query('tagId'))
    const q=z.string().max(300).optional().parse(c.req.query('q'))
    const doNext=z.enum(['true','false']).optional().parse(c.req.query('doNext')) === 'true'
    const oldestFirst=doNext||z.enum(['true','false']).optional().parse(c.req.query('oldestFirst')) === 'true'
    const limit=Math.min(200,Math.max(1,Number(c.req.query('limit'))||200))
    const offset=Math.max(0,Number(c.req.query('offset'))||0)
    const [branches,owed] = await Promise.all([listInboxBranches({ ...scope,status:doNext?'your_turn':status,characterId,tagId,q,oldestFirst,includeArchived,archivedOnly,limit,offset }),listInboxBranches({ ...scope,status:'your_turn' })])
    const overdueDrafts=await scope.db.prepare("SELECT count(*) AS count FROM reply_drafts WHERE workspace_id=? AND state='open' AND reminder_at IS NOT NULL AND reminder_at<=?").bind(scope.workspaceId,new Date().toISOString()).first<{count:number}>()
    const dueSoon=await scope.db.prepare("SELECT count(*) AS count FROM reply_branches b JOIN starters s ON s.id=b.starter_id AND s.workspace_id=b.workspace_id WHERE b.workspace_id=? AND s.archived=0 AND b.status<>'archived' AND b.archived_at IS NULL AND b.next_check_at IS NOT NULL AND b.next_check_at<=?").bind(scope.workspaceId,new Date(Date.now()+7*86400000).toISOString()).first<{count:number}>()
    return c.json({ branches,yourTurnCount:owed.length,overdueDraftCount:overdueDrafts?.count ?? 0,dueSoonCount:dueSoon?.count ?? 0,hasMore:branches.length===limit })
  })
  return app
}
