import { Hono } from 'hono'
import type { Env } from '../worker'
import { createInvite } from '../auth/invites'
import { createMagicLinks, type MailSender } from '../auth/magic-links'
import { requireWorkspace } from '../auth/sessions'

export function inviteRoutes(env: Env, sender: MailSender) {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/:workspaceId/invites', async (c) => {
    const scope = await requireWorkspace(c)
    const body = await c.req.json()
    const invite = await createInvite({ ...scope, email: body?.email, kind: body?.kind })
    await createMagicLinks(env, sender).sendMagicLink(invite.email, 'accept_invite', { inviteToken: invite.token, workspaceId: invite.workspaceId })
    return c.json({ id: invite.id, email: invite.email, kind: invite.kind, workspaceId: invite.workspaceId }, 201)
  })
  return app
}
