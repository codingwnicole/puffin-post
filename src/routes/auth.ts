import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { html } from 'hono/html'
import type { Env } from '../worker'
import { acceptInvite, normalizeEmail } from '../auth/invites'
import { createMagicLinks, type MailSender } from '../auth/magic-links'
import { endSession, requireWorkspace, startSession } from '../auth/sessions'
import { hashPassword, validPassword, verifyPassword } from '../auth/passwords'

async function provisionMagicLinkAccount(db: Env['DB'], email: string) {
  const existing = await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first<{id:string}>()
  if (existing) return
  const userId=crypto.randomUUID(),workspaceId=crypto.randomUUID(),displayName=email.split('@')[0]
  await db.batch([
    db.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)').bind(userId,email,displayName,`email:${email}`),
    db.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind(workspaceId,`${displayName}'s workspace`,userId),
    db.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(workspaceId,userId),
  ])
}

export function authRoutes(env: Env, sender: MailSender) {
  const app = new Hono<{ Bindings: Env }>()
  const links = createMagicLinks(env, sender)
  app.post('/magic-link', async (c) => {
    const body = await c.req.json()
    const email = normalizeEmail(body?.email)
    const intent = body.intent ?? 'sign_in'
    if (intent !== 'sign_in' && intent !== 'accept_invite') throw new HTTPException(400, { message: 'Invalid intent' })
    if (intent === 'sign_in') await provisionMagicLinkAccount(env.DB,email)
    await links.sendMagicLink(email, intent, intent === 'accept_invite'
      ? { inviteToken: String(body.inviteToken ?? ''), workspaceId: String(body.workspaceId ?? '') } : undefined)
    return c.json({ message: 'If you have access, a sign-in link is on its way.' }, 202)
  })
  app.get('/verify', async (c) => {
    const token = c.req.query('token') ?? ''
    let identity
    try { identity = await links.inspectMagicLink(token) } catch {
      throw new HTTPException(400, { message: 'invalid magic link' })
    }
    const confirmationUrl = new URL('/api/auth/verify', env.APP_ORIGIN).toString()
    c.header('Content-Security-Policy', `default-src 'none'; form-action ${env.APP_ORIGIN}; frame-ancestors 'none'; base-uri 'none'`)
    return c.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Confirm Puffin Post sign-in</title></head><body><main>
      <h1>Sign in to Puffin Post</h1><p>Continue as <strong>${identity.email}</strong>?</p>
      <p>Continuing will sign this browser in to this account and replace any current sign-in.</p>
      <form method="post" action="${confirmationUrl}"><input type="hidden" name="token" value="${token}"><button type="submit">Continue as ${identity.email}</button></form>
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
  app.post('/password', async c => {
    const scope=await requireWorkspace(c), body=await c.req.json<{password?:unknown}>()
    if(!validPassword(body.password)) throw new HTTPException(400,{message:'Use a password between 8 and 200 characters'})
    await scope.db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(body.password),scope.userId).run()
    return c.body(null,204)
  })
  app.post('/password-sign-in', async c => {
    const body=await c.req.json<{email?:unknown;password?:unknown}>(), email=typeof body.email==='string' ? normalizeEmail(body.email) : ''
    if(!email || !validPassword(body.password)) throw new HTTPException(401,{message:'Email or password is incorrect'})
    const user=await env.DB.prepare('SELECT u.id,u.password_hash AS passwordHash,m.workspace_id AS workspaceId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=? ORDER BY m.role=' + "'owner'" + ' DESC LIMIT 1').bind(email).first<{id:string;passwordHash:string|null;workspaceId:string}>()
    if(!user || !await verifyPassword(body.password,user.passwordHash)) throw new HTTPException(401,{message:'Email or password is incorrect'})
    await startSession(c,user.id,user.workspaceId); return c.json({message:'Signed in'})
  })
  app.post('/password-sign-up', async c => {
    const body=await c.req.json<{email?:unknown;password?:unknown}>(),email=normalizeEmail(body.email)
    if(!validPassword(body.password)) throw new HTTPException(400,{message:'Use a password between 8 and 200 characters'})
    if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) throw new HTTPException(409,{message:'An account already exists for this email. Sign in instead.'})
    const userId=crypto.randomUUID(),workspaceId=crypto.randomUUID(),displayName=email.split('@')[0]
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity,password_hash) VALUES (?,?,?,?,?)').bind(userId,email,displayName,`email:${email}`,await hashPassword(body.password)),
      env.DB.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind(workspaceId,`${displayName}'s workspace`,userId),
      env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(workspaceId,userId),
    ])
    await startSession(c,userId,workspaceId)
    return c.json({message:'Account created'},201)
  })
  return app
}
