import type { Env } from '../worker'

export interface RateLimitDecision { allowed: boolean; remaining: number; retryAfterSeconds: number }

export async function opaqueRateLimitKey(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Small D1-backed fixed-window limiter: `limit` hits per `windowMs`, keyed by caller.
 */
export async function checkRateLimit(db: Env['DB'], key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const now = Date.now()
  const iso = new Date(now).toISOString()
  const cutoff = new Date(now - windowMs).toISOString()
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE MIN(rate_limits.count + 1, ?) END,
      window_start=CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
    RETURNING count, window_start AS windowStart
  `).bind(key, iso, cutoff, limit + 1, cutoff).first<{count:number; windowStart:string}>()
  if (!row) throw new Error('Rate limit update did not return a row')
  const allowed = row.count <= limit
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((new Date(row.windowStart).getTime() + windowMs - now) / 1000))
  return { allowed, remaining: Math.max(0, limit - row.count), retryAfterSeconds }
}
