import { Hono } from 'hono'
import type { Env } from '../worker'
import { redact } from '../shared/redact'
import { checkRateLimit, opaqueRateLimitKey } from '../auth/rate-limits'

export function clientErrorRoutes(revision: string = 'rev') {
  const app = new Hono<{ Bindings: Env }>()
  // Signed-in or not: the browser posts what window.onerror captured. We only ever
  // log the redacted fields below — never the raw body — and the route is
  // rate-limited (T8a limiter, 10 per 15 min per IP) so a wedged page cannot
  // flood the log. Mounted at POST /api/client-errors.
  app.post('/', async c => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'anonymous'
    const key = await opaqueRateLimitKey(c.env.SESSION_SECRET, `client-errors:${ip}`)
    // Read the body inside the handler (some runtimes only expose it while the
    // request is live), then log it in the background.
    const body = await c.req.text().catch(() => '')
    let parsed: { message?: string; route?: string } = {}
    try { parsed = JSON.parse(body.slice(0, 2048)) as { message?: string; route?: string } } catch { /* malformed: log nothing but the shape */ }
    const entry = {
      message: redact(String(parsed.message ?? '').slice(0, 300)),
      route: redact(String(parsed.route ?? '').split('?')[0].slice(0, 100)),
      build: revision,
      userAgent: redact((c.req.header('user-agent') ?? '').slice(0, 200)),
    }
    if (await checkRateLimit(c.env.DB, key, 10, 15 * 60 * 1000).then(d => d.allowed)) console.warn('client error', entry)
    return c.body(null, 204)
  })
  return app
}
