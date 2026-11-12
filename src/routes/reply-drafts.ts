import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createReplyDraft, updateReplyDraft, listReplyDrafts, convertReplyDraft } from '../db/repositories/reply-drafts'
import { conversionSchema, draftPatchSchema, draftSchema } from './tracking-validation'

export function replyDraftRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const state = z.enum(['open','converted','archived']).optional().parse(c.req.query('state'))
    const overdue = z.enum(['true','false']).optional().parse(c.req.query('overdue'))
    return c.json(await listReplyDrafts(scope,state,overdue === 'true'))
  })
  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await createReplyDraft(scope,draftSchema.parse(await c.req.json())),201)
  })
  app.patch('/:draftId', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await updateReplyDraft(scope,c.req.param('draftId'),draftPatchSchema.parse(await c.req.json())))
  })
  app.post('/:draftId/convert', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await convertReplyDraft(scope,c.req.param('draftId'),conversionSchema.parse(await c.req.json())))
  })
  return app
}
