import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { createApp, type Env } from '../../src/worker'
import { hashPassword } from '../../src/auth/passwords'
import { checkRateLimit, opaqueRateLimitKey } from '../../src/auth/rate-limits'
import { sqlStatements } from './sql-statements'

let env: Env, dispose: () => Promise<void>
const IP = '203.0.113.7', PW = 'correct-horse-battery'

beforeEach(async () => {
  const platform = await getPlatformProxy<Env>({ persist: false })
  env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters' }
  dispose = platform.dispose
  for (const file of ['0001_initial.sql', '0002_auth.sql', '0009_triage_and_passwords.sql', '0029_rate_limits.sql']) {
    const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
    await env.DB.batch(sqlStatements(sql).map((part) => env.DB.prepare(part)))
  }
  // One real user with a password, plus their workspace membership.
  await env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity,password_hash) VALUES (?,?,?,?,?)')
    .bind('u1', 'alice@example.com', 'Alice', 'email:alice@example.com', await hashPassword(PW)).run()
  await env.DB.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind('w1', "Alice's", 'u1').run()
  await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?, 'owner')").bind('w1', 'u1').run()
})
afterEach(async () => { await dispose() })

const post = (path: string, body: unknown) => createApp(env).request(path, {
  method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': IP }, body: JSON.stringify(body),
}, env)

describe('D1-backed rate limiting for password auth', () => {
  it('allows a correct password sign-in within budget and resets the window', async () => {
    const ok = await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: PW })
    expect(ok.status).toBe(200)
    // Successful sign-in clears the limiter for that email + IP.
    const row = await env.DB.prepare('SELECT count(*) AS n FROM rate_limits').first<{ n: number }>()
    expect(row!.n).toBe(0)
  })

  it('locks out password sign-in after 10 failed attempts (429, plain message)', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: 'wrong-password-1' })
      expect(r.status).toBe(401)
    }
    const blocked = await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: PW })
    expect(blocked.status).toBe(429)
    expect(await blocked.text()).toContain('Too many')
  })

  it('blocks the correct password once the per-IP budget is spent', async () => {
    // Different email each time so the per-email cap never trips; the shared IP must.
    for (let i = 0; i < 10; i++) {
      const r = await post('/api/auth/password-sign-in', { email: `user${i}@example.com`, password: 'whatever-123' })
      expect(r.status).toBe(401)
    }
    const blocked = await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: PW })
    expect(blocked.status).toBe(429)
  })

  it('requires email verification before account creation and gives no account-existence signal', async () => {
    const existing = await post('/api/auth/password-sign-up', { email: 'alice@example.com', password: 'newbie-pass-1' })
    const newAddress = await post('/api/auth/password-sign-up', { email: 'newbie@example.com', password: 'newbie-pass-1' })
    expect(existing.status).toBe(410)
    expect(newAddress.status).toBe(410)
    expect(await existing.text()).toBe(await newAddress.text())
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind('newbie@example.com').first<{ n: number }>())!.n).toBe(0)
  })

  it('enforces a concurrent request budget atomically', async () => {
    const decisions = await Promise.all(Array.from({ length: 40 }, () => checkRateLimit(env.DB, 'parallel-test', 10, 60_000)))
    expect(decisions.filter(decision => decision.allowed)).toHaveLength(10)
    expect(decisions.filter(decision => !decision.allowed)).toHaveLength(30)
  })

  it('releases the window after it expires (15 min)', async () => {
    for (let i = 0; i < 10; i++) await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: 'wrong-12345' })
    expect((await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: 'wrong-12345' })).status).toBe(429)
    // Age the stored window past the 15-minute limit; the next hit starts fresh.
    const emailKey = await opaqueRateLimitKey(env.SESSION_SECRET, 'password:email:alice@example.com')
    const ipKey = await opaqueRateLimitKey(env.SESSION_SECRET, `password:ip:${IP}`)
    await env.DB.prepare('UPDATE rate_limits SET window_start=? WHERE key IN (?,?)')
      .bind(new Date(Date.now() - 16 * 60_000).toISOString(), emailKey, ipKey).run()
    const after = await post('/api/auth/password-sign-in', { email: 'alice@example.com', password: PW })
    expect(after.status).toBe(200)
  })
})
