import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { trackingFixture } from './tracking-fixture'
import { createApp } from '../../src/worker'
import { startSession } from '../../src/auth/sessions'

let env: Awaited<ReturnType<typeof trackingFixture>>['env']
let request: (path: string, method?: string, body?: unknown, tenant?: string) => Promise<Response>
let dispose: () => Promise<void>
const characterA = 'character-a'

beforeAll(async () => {
  const fx = await trackingFixture()
  env = fx.env; request = fx.request; dispose = fx.dispose
})
afterAll(async () => { await dispose() })

const cookieFor = async (userId: string, workspaceId = userId) => {
  const login = new Hono<{ Bindings: typeof env }>()
  login.get('/', async c => { await startSession(c, userId, workspaceId); return c.text('ok') })
  return (await login.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
}
// Moderator access is granted only to the configured server-side user ID.
describe('support board moderation is admin-only', () => {
  it('lets a member file a report but no non-admin may patch, delete, or reply', async () => {
    const file = await request('/api/support', 'POST', { kind: 'bug', title: 'Broken export', description: 'Export CSV throws a 500' }, 'a')
    expect(file.status).toBe(201)
    const { id } = await file.json() as any

    expect((await request(`/api/support/${id}`, 'PATCH', { status: 'fixed' }, 'b')).status).toBe(403)
    expect((await request(`/api/support/${id}/comments`, 'POST', { body: 'On it.' }, 'b')).status).toBe(403)
    expect((await request(`/api/support/${id}`, 'DELETE', undefined, 'b')).status).toBe(403)

    // A (the reporter, still not the admin) cannot moderate either.
    expect((await request(`/api/support/${id}`, 'PATCH', { status: 'fixed' }, 'a')).status).toBe(403)
    expect((await request(`/api/support/${id}`, 'DELETE', undefined, 'a')).status).toBe(403)

    // The row and no comment survive the attacks.
    const row = await env.DB.prepare('SELECT status FROM support_items WHERE id=?').bind(id).first<{ status: string }>()
    expect(row?.status).toBe('reported')
    const comments = await env.DB.prepare('SELECT count(*) AS n FROM support_comments WHERE support_item_id=?').bind(id).first<{ n: number }>()
    expect(comments!.n).toBe(0)
  })

  it('does not grant moderation by email and lets only the configured user ID moderate', async () => {
    const file = await request('/api/support', 'POST', { kind: 'feature', title: 'Add dark mode', description: 'Please add a dark theme option' }, 'a')
    const { id } = await file.json() as any
    await env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)')
      .bind('spoof-user', 'admin@example.com', 'Spoof', 'email:admin@example.com').run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('a','spoof-user','member')").run()
    env.MODERATOR_USER_ID = 'configured-admin'
    const spoofCookie = await cookieFor('spoof-user', 'a')
    const spoofPatch = await createApp(env).request(`/api/support/${id}`, {
      method: 'PATCH', headers: { cookie: spoofCookie, origin: env.APP_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'fixed' }),
    }, env)
    expect(spoofPatch.status).toBe(403)

    await env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)')
      .bind('configured-admin', 'moderator@example.com', 'Moderator', 'email:moderator@example.com').run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('a','configured-admin','member')").run()
    const cookie = await cookieFor('configured-admin', 'a')

    const patch = await createApp(env).request(`/api/support/${id}`, {
      method: 'PATCH', headers: { cookie, origin: env.APP_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'fixed' }),
    }, env)
    expect(patch.status).toBe(200)
    const shareResponse = await request('/api/characters/character-a/share', 'PUT', { style: 'card', showMoodboard: false, showPlaylist: false, showStats: false, indexable: false }, 'a')
    const { slug } = await shareResponse.json() as { slug: string }
    const spoofDisable = await createApp(env).request(`/api/share-admin/${slug}/disable`, { method: 'POST', headers: { cookie: spoofCookie, origin: env.APP_ORIGIN } }, env)
    expect(spoofDisable.status).toBe(403)
    const disable = await createApp(env).request(`/api/share-admin/${slug}/disable`, { method: 'POST', headers: { cookie, origin: env.APP_ORIGIN } }, env)
    expect(disable.status).toBe(200)
    const del = await createApp(env).request(`/api/support/${id}`, { method: 'DELETE', headers: { cookie, origin: env.APP_ORIGIN } }, env)
    expect(del.status).toBe(204)
    const remaining = await env.DB.prepare('SELECT count(*) AS n FROM support_items WHERE id=?').bind(id).first<{ n: number }>()
    expect(remaining!.n).toBe(0)
  })
})

describe('user-supplied link URLs are http(s)-only', () => {
  it('does not follow a Spotify short-link redirect to a private address', async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []
    const redirectModes: Array<RequestRedirect | undefined> = []
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      redirectModes.push(init?.redirect)
      if (url.startsWith('https://open.spotify.com/oembed?')) return new Response(JSON.stringify({ title: 'Track title' }), { headers: { 'content-type': 'application/json' } })
      if (url === 'https://spotify.link/abc') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
      throw new Error('Unexpected external request')
    }
    try {
      const url = encodeURIComponent('https://spotify.link/abc')
      const response = await request(`/api/characters/song-lookup?url=${url}`, 'GET', undefined, 'a')
      expect(response.status).toBe(200)
      expect(calls).toEqual([
        expect.stringContaining('https://open.spotify.com/oembed?'),
        'https://spotify.link/abc',
      ])
      expect(redirectModes).toEqual(['manual', 'manual'])
      expect(calls.some(call => call.includes('127.0.0.1'))).toBe(false)
      const insecure = await request(`/api/characters/song-lookup?url=${encodeURIComponent('http://spotify.link/abc')}`, 'GET', undefined, 'a')
      expect(insecure.status).toBe(400)
      expect(calls).toHaveLength(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects javascript: and data: quicklinks with 400', async () => {
    for (const evil of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      const r = await request(`/api/characters/${characterA}/quicklinks`, 'POST', { label: 'x', url: evil }, 'a')
      expect(r.status).toBe(400)
    }
    const ok = await request(`/api/characters/${characterA}/quicklinks`, 'POST', { label: 'ok', url: 'https://example.com' }, 'a')
    expect(ok.status).toBe(201)
    const row = await env.DB.prepare("SELECT count(*) AS n FROM character_quicklinks WHERE character_id=? AND (url LIKE 'javascript%' OR url LIKE 'data:%')").bind(characterA).first<{ n: number }>()
    expect(row!.n).toBe(0)
  })

  it('rejects javascript: and data: plan resources with 400', async () => {
    const plan = await request('/api/character-planner', 'POST', { name: 'A plan' }, 'a')
    expect(plan.status).toBe(201)
    const { id } = await plan.json() as any
    for (const evil of ['javascript:alert(1)', 'data:application/x-svg+xml,<svg/>']) {
      const r = await request(`/api/character-planner/${id}/resources`, 'POST', { label: 'x', url: evil }, 'a')
      expect(r.status).toBe(400)
    }
    expect((await request(`/api/character-planner/${id}/resources`, 'POST', { label: 'ok', url: 'https://example.com' }, 'a')).status).toBe(201)
  })
})
