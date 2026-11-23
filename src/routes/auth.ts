import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { html } from 'hono/html'
import type { Env } from '../worker'
import { acceptInvite, normalizeEmail } from '../auth/invites'
import { createMagicLinks, type MailSender } from '../auth/magic-links'
import { endSession, requireWorkspace, startSession } from '../auth/sessions'
import { hashPassword, validPassword, verifyPassword } from '../auth/passwords'
import { checkRateLimit, opaqueRateLimitKey } from '../auth/rate-limits'

function invalidMagicLinkPage(appOrigin:string){
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign-in link unavailable · RP Thread Buddy</title><style>
    *{box-sizing:border-box}body{min-width:320px;min-height:100dvh;margin:0;display:grid;place-items:center;padding:1rem;background:#142027;color:#f8f3e9;font:1rem/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(100%,34rem);padding:clamp(1.5rem,6vw,2.5rem);border:1px solid #4c6670;border-radius:1.1rem;background:#213138;box-shadow:0 1.25rem 3rem #0003}p.eyebrow{color:#a9d4dc;font-size:.75rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{margin:.4rem 0;font:600 clamp(2rem,7vw,3rem)/1 Georgia,"Times New Roman",serif;letter-spacing:-.04em}p{color:#d9e1dd}a{display:grid;place-items:center;min-height:3rem;margin-top:1.5rem;padding:.7rem 1rem;border-radius:.7rem;background:#a9d4dc;color:#17242a;font-weight:800;text-align:center;text-decoration:none}a:focus-visible{outline:3px solid #fff;outline-offset:3px}
    </style></head><body><main><p class="eyebrow">RP Thread Buddy</p><h1>This sign-in link can’t be used.</h1><p>It may have expired or already been used. Request a fresh link to sign in; your account and saved threads are still here.</p><a href="${appOrigin}/">Return to sign in</a></main></body></html>`
}

async function provisionMagicLinkAccount(db: Env['DB'], email: string) {
  const userId=crypto.randomUUID(),workspaceId=crypto.randomUUID(),displayName=email.split('@')[0]
  // Keep concurrent first sign-ins atomic: a losing insert must never observe a user before its workspace exists.
  await db.batch([
    db.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(userId,email,displayName,`email:${email}`),
    db.prepare('INSERT INTO workspaces (id,name,owner_user_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND email=?)').bind(workspaceId,`${displayName}'s workspace`,userId,userId,email),
    db.prepare("INSERT INTO memberships (workspace_id,user_id,role) SELECT ?,?,'owner' WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=?)").bind(workspaceId,userId,workspaceId,userId),
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
    const ip = c.req.header('cf-connecting-ip') || 'unknown'
    const ipKey = await opaqueRateLimitKey(env.SESSION_SECRET, `magic_link:ip:${ip}`)
    if (!(await checkRateLimit(env.DB, ipKey, 20, 60 * 60_000)).allowed) {
      return c.json({ message: 'If you have access, a sign-in link is on its way.' }, 202)
    }
    if (intent === 'sign_in') await provisionMagicLinkAccount(env.DB,email)
    await links.sendMagicLink(email, intent, intent === 'accept_invite'
      ? { inviteToken: String(body.inviteToken ?? ''), workspaceId: String(body.workspaceId ?? '') } : undefined)
    return c.json({ message: 'If you have access, a sign-in link is on its way.' }, 202)
  })
  app.get('/verify', async (c) => {
    const token = c.req.query('token') ?? ''
    let identity
    try { identity = await links.inspectMagicLink(token) } catch {
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
      return c.html(invalidMagicLinkPage(env.APP_ORIGIN),400)
    }
    const confirmationUrl = new URL('/api/auth/verify', env.APP_ORIGIN).toString()
    // This confirmation intentionally stays script-free. Inline CSS is the only
    // exception to the otherwise locked-down document CSP, so it can match RP Thread Buddy.
    c.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${env.APP_ORIGIN}; frame-ancestors 'none'; base-uri 'none'`)
    return c.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Confirm RP Thread Buddy sign-in</title><style>
      :root{color-scheme:dark}*{box-sizing:border-box}body{min-width:320px;margin:0;background:#142027;color:#f8f3e9;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100% - 2rem,35rem);min-height:100dvh;margin:auto;display:grid;align-content:center;padding:2rem 0 4rem}.brand{display:flex;align-items:center;gap:.7rem;margin-bottom:2.4rem;color:#f8f3e9;font:600 1.4rem/1 Georgia,"Times New Roman",serif}.mark{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:50%;background:#dce8e9;color:#263d45;font:800 1rem Georgia,"Times New Roman",serif;letter-spacing:-.08em}.card{padding:clamp(1.5rem,5vw,2.5rem);border:1px solid #4c6670;border-radius:1.25rem;background:#213138;box-shadow:0 1.25rem 3rem rgba(0,0,0,.18)}.eyebrow{margin:0 0 .7rem;color:#a9d4dc;font-size:.72rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{margin:0;font:600 clamp(2rem,7vw,3rem)/1 Georgia,"Times New Roman",serif;letter-spacing:-.04em}p{margin:1.25rem 0 0;color:#d9e1dd;line-height:1.65}.identity{margin-top:1.5rem;padding:1rem 1.1rem;border-left:.25rem solid #a9d4dc;border-radius:.5rem;background:#2a3e45;color:#f8f3e9;overflow-wrap:anywhere}.identity strong{display:block;margin-top:.2rem;font-size:1rem}.button{width:100%;min-height:3.25rem;margin-top:1.75rem;padding:.85rem 1rem;border:1px solid #a9d4dc;border-radius:.7rem;background:#a9d4dc;color:#17242a;font:800 1rem/1 ui-sans-serif,system-ui;cursor:pointer}.button:hover{filter:brightness(1.06)}.fine-print{margin-top:1.15rem;color:#b9c8c7;font-size:.84rem}.footer{margin:1.3rem 0 0;color:#9badad;font-size:.78rem;line-height:1.55;text-align:center}@media (max-width:430px){main{width:min(100% - 1.5rem,35rem);padding-top:1.25rem}.brand{margin-bottom:1.6rem}.card{border-radius:1rem}}
    </style></head><body><main>
      <div class="brand" aria-label="RP Thread Buddy"><span class="mark" aria-hidden="true">RP</span><span>RP Thread Buddy</span></div>
      <section class="card" aria-labelledby="confirm-title"><p class="eyebrow">One last step</p><h1 id="confirm-title">Open your writing space.</h1>
      <p>Confirm the account below to continue to RP Thread Buddy.</p><p class="identity">Signing in as<strong>${identity.email}</strong></p>
      <form method="post" action="${confirmationUrl}"><input type="hidden" name="token" value="${token}"><button class="button" type="submit">Continue to RP Thread Buddy</button></form>
      <p class="fine-print">This will sign this browser in to this account and replace any current sign-in.</p></section>
      <p class="footer">Only continue if you requested this private sign-in link.</p>
      </main></body></html>`)
  })
  app.post('/verify', async (c) => {
    const body = await c.req.parseBody()
    let identity
    try { identity = await links.consumeMagicLink(typeof body.token === 'string' ? body.token : '') } catch {
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
      return c.html(invalidMagicLinkPage(env.APP_ORIGIN),400)
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
    const ip=c.req.header('cf-connecting-ip') || 'unknown'
    // Throttle credential guessing: 10 failed attempts per email, 10 per IP,
    // each over a 15-minute fixed window. Successful sign-ins reset both keys.
    // D1 rows are the only state; a coordinated attack across many IPs can still
    // has to survive a fleet of coordinated IPs behind one address.
    const emailKey = await opaqueRateLimitKey(env.SESSION_SECRET, `password:email:${email}`)
    const ipKey = await opaqueRateLimitKey(env.SESSION_SECRET, `password:ip:${ip}`)
    const rate=(await checkRateLimit(env.DB,emailKey,10,15*60_000)).allowed
      &&(await checkRateLimit(env.DB,ipKey,10,15*60_000)).allowed
    if(!rate) throw new HTTPException(429,{message:'Too many sign-in attempts, please wait'})
    if(!email || !validPassword(body.password)) throw new HTTPException(401,{message:'Email or password is incorrect'})
    const user=await env.DB.prepare('SELECT u.id,u.password_hash AS passwordHash,m.workspace_id AS workspaceId FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=? ORDER BY m.role=' + "'owner'" + ' DESC LIMIT 1').bind(email).first<{id:string;passwordHash:string|null;workspaceId:string}>()
    const ok=!!user && await verifyPassword(body.password,user.passwordHash)
    if(!ok) throw new HTTPException(401,{message:'Email or password is incorrect'})
    await env.DB.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').bind(emailKey,ipKey).run()
    await startSession(c,user!.id,user!.workspaceId); return c.json({message:'Signed in'})
  })
  app.post('/password-sign-up', async c => {
    throw new HTTPException(410, { message: 'Create an account with an email sign-in link, then add a password in Settings.' })
  })
  return app
}
