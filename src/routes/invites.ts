import { Hono } from 'hono'
import type { Env } from '../worker'
import { createInvite } from '../auth/invites'
import { createMagicLinks, type MailSender } from '../auth/magic-links'
import { requireWorkspace } from '../auth/sessions'

export function inviteRoutes(env: Env, sender: MailSender) {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/:workspaceId/invites', async c => {
    const scope=await requireWorkspace(c); if(scope.role!=='owner') return c.json({error:'Owner access required'},403)
    const rows=await scope.db.prepare('SELECT id,email,kind,expires_at AS expiresAt FROM invites WHERE workspace_id=? AND accepted_at IS NULL ORDER BY expires_at DESC').bind(scope.workspaceId).all()
    return c.json(rows.results)
  })
  app.post('/:workspaceId/invites', async (c) => {
    const scope = await requireWorkspace(c)
    const body = await c.req.json()
    const invite = await createInvite({ ...scope, email: body?.email, kind: body?.kind })
    await createMagicLinks(env, sender).sendMagicLink(invite.email, 'accept_invite', { inviteToken: invite.token, workspaceId: invite.workspaceId })
    return c.json({ id: invite.id, email: invite.email, kind: invite.kind, workspaceId: invite.workspaceId }, 201)
  })
  app.delete('/:workspaceId/invites/:inviteId', async c => {
    const scope = await requireWorkspace(c)
    if (scope.role !== 'owner') return c.json({error:'Owner access required'},403)
    const result = await scope.db.prepare('UPDATE invites SET accepted_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL')
      .bind(new Date().toISOString(),c.req.param('inviteId'),scope.workspaceId).run()
    if (!result.meta.changes) return c.json({error:'Invite not found'},404)
    return c.body(null,204)
  })
  return app
}
