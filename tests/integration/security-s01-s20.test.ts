import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { createApp, type Env } from '../../src/worker'
import { startSession } from '../../src/auth/sessions'
import { Hono } from 'hono'

// S01/S06: protected /api routes must refuse unauthenticated requests and
// cross-origin state changes, no matter what headers the caller spoofs.
describe('S01/S06 unauthenticated API access', () => {
  let env: Env
  let dispose: () => Promise<void>
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters' }
    dispose = platform.dispose
    for (const file of ['0001_initial.sql', '0002_auth.sql']) {
      const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
      await env.DB.batch(sql.split(';').filter(part => part.trim()).map(part => env.DB.prepare(part)))
    }
    await env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('u1','u1@example.com','u1','email:u1@example.com')").run()
    await env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('w1','w1','u1')").run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('w1','u1','owner')").run()
    app = createApp(env)
  }, 30_000)

  afterEach(async () => { await dispose?.() })

  it('rejects GET on protected routes with no session (401)', async () => {
    for (const path of ['/api/inbox', '/api/characters', '/api/settings', '/api/partners', '/api/export.csv']) {
      const response = await app.request(path, { method: 'GET' }, env)
      expect(response.status, path).toBe(401)
    }
  })

  it('rejects POST on protected routes with no session (401) even with spoofed internal headers', async () => {
    const response = await app.request('/api/starters', {
      method: 'POST',
      headers: {
        origin: env.APP_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': '10.0.0.1',
        'x-real-ip': '127.0.0.1',
      },
      body: JSON.stringify({ characterId: 'x', title: 't', postUrl: 'https://a.tumblr.com/post/1' }),
    }, env)
    expect(response.status).toBe(401)
  })

  it('rejects cross-origin state changes before any auth check (403)', async () => {
    const response = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
    }, env)
    expect(response.status).toBe(403)
  })
})

// S14: user-stored browser push endpoints are server-side fetch targets, so they
// must be restricted to known push services and deliveries must time out.
describe('S14 push endpoint allowlist', () => {
  let env: Env
  let dispose: () => Promise<void>
  let app: ReturnType<typeof createApp>
  let cookie: string

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters' }
    dispose = platform.dispose
    for (const file of ['0001_initial.sql', '0002_auth.sql', '0010_push_subscriptions.sql']) {
      const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
      await env.DB.batch(sql.split(';').filter(part => part.trim()).map(part => env.DB.prepare(part)))
    }
    await env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('u1','u1@example.com','u1','email:u1@example.com')").run()
    await env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('w1','w1','u1')").run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('w1','u1','owner')").run()
    app = createApp(env)
    // Build a real session cookie through the same code path the worker uses.
    const sessionApp = new Hono<{ Bindings: Env }>()
    sessionApp.get('/', async c => { await startSession(c, 'u1', 'w1'); return c.text('ok') })
    cookie = (await sessionApp.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
  }, 30_000)

  afterEach(async () => { await dispose?.() })

  const subscribe = (endpoint: string) => app.request('/api/push/subscription', {
    method: 'POST',
    headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', cookie },
    body: JSON.stringify({ endpoint }),
  }, env)

  it('accepts a well-known push service endpoint (204)', async () => {
    expect((await subscribe('https://fcm.googleapis.com/fcm/send/test-token')).status).toBe(204)
    expect((await subscribe('https://updates.push.services.mozilla.com/wpush/v1/test')).status).toBe(204)
  })

  it('does not reassign another user\'s endpoint and limits devices per account', async () => {
    const sharedEndpoint = 'https://fcm.googleapis.com/fcm/send/shared-token'
    expect((await subscribe(sharedEndpoint)).status).toBe(204)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('u2','u2@example.com','u2','email:u2@example.com')"),
      env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('w2','w2','u2')"),
      env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('w2','u2','owner')"),
    ])
    const sessionApp = new Hono<{ Bindings: Env }>()
    sessionApp.get('/', async c => { await startSession(c, 'u2', 'w2'); return c.text('ok') })
    const otherCookie = (await sessionApp.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
    const takeover = await app.request('/api/push/subscription', {
      method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', cookie: otherCookie },
      body: JSON.stringify({ endpoint: sharedEndpoint }),
    }, env)
    expect(takeover.status).toBe(429)
    expect((await env.DB.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint=?').bind(sharedEndpoint).first<{ user_id: string }>())!.user_id).toBe('u1')

    for (let index = 0; index < 4; index++) expect((await subscribe(`https://fcm.googleapis.com/fcm/send/device-${index}`)).status).toBe(204)
    expect((await subscribe('https://fcm.googleapis.com/fcm/send/device-over-limit')).status).toBe(429)
  })

  it('rejects an attacker-chosen endpoint host (400)', async () => {
    expect((await subscribe('https://evil.example.com/push')).status).toBe(400)
    expect((await subscribe('https://169.254.169.254/latest/meta-data')).status).toBe(400)
  })

  it('rejects malformed and non-https endpoints (400)', async () => {
    expect((await subscribe('http://fcm.googleapis.com/fcm/send/x')).status).toBe(400)
    expect((await subscribe('not a url')).status).toBe(400)
  })
})
