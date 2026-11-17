import type { Env } from '../worker'

export interface RateLimitDecision { allowed: boolean; remaining: number; retryAfterSeconds: number }

/**
 * Small D1-backed rate limiter: `limit` hits per `windowMs` rolling window,
 * keyed by caller. The window resets after `windowMs` of quiet.
 */
export async function checkRateLimit(db: Env['DB'], key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const now = Date.now()
  const iso = new Date(now).toISOString()
  const row = await db.prepare('SELECT count, window_start AS windowStart FROM rate_limits WHERE key=?').bind(key).first<{count:number; windowStart:string}>()
  if (row) {
    if (now - new Date(row.windowStart).getTime() >= windowMs) {
      // Window expired: reset and count this hit as the first of a new window.
      await db.prepare('UPDATE rate_limits SET count=1, window_start=? WHERE key=?').bind(iso, key).run()
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
    }
    if (row.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(row.windowStart).getTime() + windowMs - now) / 1000))
      return { allowed: false, remaining: 0, retryAfterSeconds }
    }
    await db.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run()
    return { allowed: true, remaining: limit - row.count - 1, retryAfterSeconds: 0 }
  }
  await db.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?,1,?)').bind(key, iso).run()
  return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
}
