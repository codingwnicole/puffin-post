import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { html } from 'hono/html'
import type { Env } from '../worker'
import { acceptInvite, normalizeEmail, provisionBootstrapOwner } from '../auth/invites'
import { createMagicLinks, type MailSender } from '../auth/magic-links'
import { endSession, requireWorkspace, startSession } from '../auth/sessions'

export function authRoutes(env: Env, sender: MailSender) {
  const app = new Hono<{ Bindings: Env }>()
  const links = createMagicLinks(env, sender)
  app.post('/magic-link', async (c) => {
    const body = await c.req.json()
    const email = normalizeEmail(body?.email)
    const intent = body.intent ?? 'sign_in'
    if (intent !== 'sign_in' && intent !== 'accept_invite') throw new HTTPException(400, { message: 'Invalid intent' })
    try {
      await links.sendMagicLink(email, intent, intent === 'accept_invite'
        ? { inviteToken: String(body.inviteToken ?? ''), workspaceId: String(body.workspaceId ?? '') } : undefined)
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid magic link' && intent === 'sign_in') {
        if (await provisionBootstrapOwner(env.DB, email, env.BOOTSTRAP_OWNER_EMAIL)) {
          await links.sendMagicLink(email, 'sign_in')
        }
        return c.json({ message: 'If you have access, a sign-in link is on its way.' }, 202)
      }
      throw error
    }
    return c.json({ message: 'If you have access, a sign-in link is on its way.' }, 202)
  })
  app.get('/verify', async (c) => {
    const token = c.req.query('token') ?? ''
    let identity
    try { identity = await links.inspectMagicLink(token) } catch {
      throw new HTTPException(400, { message: 'invalid magic link' })
    }
    c.header('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    return c.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Confirm Puffin Post sign-in</title></head><body><main>
      <h1>Sign in to Puffin Post</h1><p>Continue as <strong>${identity.email}</strong>?</p>
      <p>Continuing will sign this browser in to this account and replace any current sign-in.</p>
      <form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${token}"><button type="submit">Continue as ${identity.email}</button></form>
      </main></body></html>`)
  })
  app.post('/verify', async (c) => {
    const body = await c.req.parseBody()
    let identity
    try { identity = await links.consumeMagicLink(typeof body.token === 'string' ? body.token : '') } catch {
      throw new HTTPException(400, { message: 'invalid magic link' })
    }
    let userId: string
    let workspaceId = identity.workspaceId
    if (identity.intent === 'accept_invite') {
      const accepted = await acceptInvite(env.DB, identity.inviteId!, identity.email, identity.workspaceId)
      userId = accepted.userId
      workspaceId = accepted.workspaceId
    } else {
      const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(identity.email).first<{ id: string }>()
      if (!user) throw new HTTPException(400, { message: 'invalid magic link' })
      userId = user.id
    }
    await startSession(c, userId, workspaceId)
    return c.redirect('/', 302)
  })
  app.get('/session', async (c) => {
    const { userId, email, workspaceId, role } = await requireWorkspace(c)
    return c.json({ userId, email, workspaceId, role })
  })
  app.post('/sign-out', async (c) => {
    await endSession(c)
    return c.body(null, 204)
  })
  return app
}
