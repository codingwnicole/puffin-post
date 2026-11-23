import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { checkRateLimit } from '../auth/rate-limits'
import type { Env } from '../worker'
import { SUPPORT_EMAIL } from './support'

async function emailOwner(env: Env, to: string, from: string, message: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject: 'New RP Thread Buddy feature suggestion',
      text: `From: ${from}\n\n${message}`,
    }),
  })
  if (!response.ok) throw new Error('Unable to email the suggestion')
}

export function featureSuggestionRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ message: z.string().trim().min(8).max(5000) }).strict().parse(await c.req.json())
    if (!(await checkRateLimit(scope.db, `feature_suggestion:${scope.userId}`, 5, 60 * 60_000)).allowed) {
      throw new HTTPException(429, { message: 'Too many suggestions. Try again later.' })
    }
    const createdAt = new Date().toISOString()
    await scope.db.prepare('INSERT INTO feature_suggestions (id,workspace_id,submitted_by_user_id,message,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), scope.workspaceId, scope.userId, body.message, createdAt).run()
    await emailOwner(c.env, SUPPORT_EMAIL, scope.email, body.message)
    return c.json({ ok: true }, 201)
  })
  return app
}
