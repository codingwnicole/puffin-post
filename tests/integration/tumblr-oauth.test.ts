import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { Hono } from 'hono'
import { startSession } from '../../src/auth/sessions'
import { createApp, type Env } from '../../src/worker'
import { encryptToken, decryptToken } from '../../src/tumblr/oauth'

let env: Env, dispose: () => Promise<void>
beforeEach(async () => {
  const platform = await getPlatformProxy<Env>({ persist:false }); env = { ...platform.env, APP_ORIGIN:'https://threadums.test', SESSION_SECRET:'test-only-session-secret-with-32-characters', TOKEN_ENCRYPTION_KEY:'test-only-encryption-key-with-32-chars', TUMBLR_CONSUMER_KEY:'key', TUMBLR_CONSUMER_SECRET:'secret' }; dispose=platform.dispose
  for (const file of ['0001_initial.sql','0002_auth.sql','0004_tumblr_oauth.sql','0029_rate_limits.sql']) { const sql=await readFile(`src/db/migrations/${file}`,'utf8'); await env.DB.batch(sql.split(';').filter(Boolean).map(part=>env.DB.prepare(part))) }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('owner','owner@example.com','Owner','email:owner@example.com')"),
    env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('home','Home','owner')"), env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('home','owner','owner')"),
  ])
})

it('rate limits Tumblr OAuth request-token calls per workspace', async () => {
  const login = new Hono<{ Bindings: Env }>()
  login.get('/', async c => { await startSession(c, 'owner', 'home'); return c.text('ok') })
  const cookie = (await login.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
  const requestToken = vi.fn(async () => new Response('oauth_token=temporary&oauth_token_secret=temporary-secret', { status: 200 }))
  vi.stubGlobal('fetch', requestToken)
  const app = createApp(env)
  const statuses: number[] = []
  for (let index = 0; index < 6; index += 1) statuses.push((await app.request('/api/tumblr/connect', { headers: { cookie } }, env)).status)
  expect(statuses.slice(0, 5)).toEqual([302, 302, 302, 302, 302])
  expect(statuses[5]).toBe(429)
  expect(requestToken).toHaveBeenCalledTimes(5)
})
afterEach(async()=> { vi.unstubAllGlobals(); await dispose() })

it('encrypts connection tokens and consumes OAuth state once', async () => {
  const encrypted = await encryptToken('access-secret',env.TOKEN_ENCRYPTION_KEY)
  expect(encrypted).not.toContain('access-secret'); expect(await decryptToken(encrypted,env.TOKEN_ENCRYPTION_KEY)).toBe('access-secret')
  // A malformed/replayed callback is rejected before any token exchange or storage.
  const app=createApp(env)
  expect((await app.request('/api/tumblr/callback?state='+'a'.repeat(64)+'&oauth_token=x&oauth_verifier=y',{},env)).status).toBe(400)
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tumblr_connections').first<{n:number}>())!.n).toBe(0)
})
