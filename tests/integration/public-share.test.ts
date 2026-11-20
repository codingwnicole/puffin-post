import { describe, expect, it, vi, afterEach } from 'vitest'
import { trackingFixture } from './tracking-fixture'
import { createApp } from '../../src/worker'

const PNG: BlobPart = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])

describe('public share links', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('full share lifecycle: enable, public page, rotate, delete, tenant isolation', async () => {
    const fixture = await trackingFixture()
    try {
      const app = createApp(fixture.env)
      const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
      const h = (tenant: string, extra: Record<string, string> = {}) => ({ origin: fixture.env.APP_ORIGIN, cookie: fixture.cookies[tenant] ?? '', ...extra })
      const json = (tenant: string, extra: Record<string, string> = {}) => h(tenant, { 'content-type': 'application/json', ...extra })

      // Enable share
      const enableRes = await app.request('/api/characters/character-a/share', { method: 'PUT', body: JSON.stringify({ style: 'card', showMoodboard: false, showPlaylist: false, showStats: false, indexable: false }), headers: json('a') }, fixture.env, stubCtx)
      expect(enableRes.status).toBe(201)
      const share = await enableRes.json() as { slug: string; url: string; style: string }
      expect(share.slug).toHaveLength(10)
      expect(share.url).toContain('/c/' + share.slug)
      expect(share.style).toBe('card')

      // GET share settings
      const getRes = await app.request('/api/characters/character-a/share', { headers: h('a') }, fixture.env, stubCtx)
      expect(getRes.status).toBe(200)
      const settings = await getRes.json() as { slug: string }
      expect(settings.slug).toBe(share.slug)

      // Public page without cookie
      const pageRes = await app.request(`/c/${share.slug}`, {}, fixture.env, stubCtx)
      expect(pageRes.status).toBe(200)
      const html = await pageRes.text()
      expect(html).toContain('Character a')
      expect(html).toContain('noindex')
      expect(pageRes.headers.get('x-robots-tag')).toContain('noindex')
      expect(pageRes.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")

      // Stats hidden by default (showStats=false)
      expect(html).not.toMatch(/\d+\s*threads/)
      expect(html).not.toContain('your turn')

      // Enable stats and check
      await app.request('/api/characters/character-a/share', { method: 'PUT', body: JSON.stringify({ style: 'card', showMoodboard: false, showPlaylist: false, showStats: true, indexable: false }), headers: json('a') }, fixture.env, stubCtx)
      const statsPage = await (await app.request(`/c/${share.slug}`, {}, fixture.env, stubCtx)).text()
      expect(statsPage).toContain('Thread Stats')

      // Moodboard image 404 when show_moodboard=0
      const moodRes = await app.request(`/c/${share.slug}/m/nonexistent`, {}, fixture.env, stubCtx)
      expect(moodRes.status).toBe(404)

      // Embed route has frame-ancestors *
      const embedRes = await app.request(`/c/${share.slug}/embed`, {}, fixture.env, stubCtx)
      expect(embedRes.status).toBe(200)
      expect(embedRes.headers.get('content-security-policy')).toContain('frame-ancestors *')
      expect(embedRes.headers.get('x-robots-tag')).toContain('noindex')

      // User text with <script> is escaped
      await fixture.env.DB.prepare('UPDATE characters SET name=? WHERE id=?').bind('<script>alert(1)</script>', 'character-a').run()
      const xssPage = await (await app.request(`/c/${share.slug}`, {}, fixture.env, stubCtx)).text()
      expect(xssPage).not.toContain('<script>alert(1)</script>')
      expect(xssPage).toContain('&lt;script&gt;')
      await fixture.env.DB.prepare('UPDATE characters SET name=? WHERE id=?').bind('Character a', 'character-a').run()

      // Rotate slug
      const rotateRes = await app.request('/api/characters/character-a/share/rotate', { method: 'POST', headers: h('a') }, fixture.env, stubCtx)
      expect(rotateRes.status).toBe(200)
      const rotated = await rotateRes.json() as { slug: string }
      expect(rotated.slug).not.toBe(share.slug)

      // Old slug 404
      expect((await app.request(`/c/${share.slug}`, {}, fixture.env, stubCtx)).status).toBe(404)
      // New slug works
      expect((await app.request(`/c/${rotated.slug}`, {}, fixture.env, stubCtx)).status).toBe(200)

      // Tenant b cannot access character-a share routes
      expect((await app.request('/api/characters/character-a/share', { method: 'PUT', body: JSON.stringify({ style: 'card', showMoodboard: false, showPlaylist: false, showStats: false, indexable: false }), headers: json('b') }, fixture.env, stubCtx)).status).toBe(404)
      expect((await app.request('/api/characters/character-a/share', { method: 'DELETE', headers: h('b') }, fixture.env, stubCtx)).status).toBe(404)

      // Delete share
      const delRes = await app.request('/api/characters/character-a/share', { method: 'DELETE', headers: h('a') }, fixture.env, stubCtx)
      expect(delRes.status).toBe(204)
      expect((await app.request(`/c/${rotated.slug}`, {}, fixture.env, stubCtx)).status).toBe(404)
    } finally { await fixture.dispose() }
  })

  it('disabled_by_moderator returns 404', async () => {
    const fixture = await trackingFixture()
    try {
      const app = createApp(fixture.env)
      const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
      const h = (tenant: string, extra: Record<string, string> = {}) => ({ origin: fixture.env.APP_ORIGIN, cookie: fixture.cookies[tenant] ?? '', ...extra })
      const json = (tenant: string, extra: Record<string, string> = {}) => h(tenant, { 'content-type': 'application/json', ...extra })

      const share = await (await app.request('/api/characters/character-a/share', { method: 'PUT', body: JSON.stringify({ style: 'card', showMoodboard: false, showPlaylist: false, showStats: false, indexable: false }), headers: json('a') }, fixture.env, stubCtx)).json() as { slug: string }

      // Moderator disable
      await fixture.env.DB.prepare('UPDATE character_shares SET disabled_by_moderator=1 WHERE slug=?').bind(share.slug).run()
      expect((await app.request(`/c/${share.slug}`, {}, fixture.env, stubCtx)).status).toBe(404)
    } finally { await fixture.dispose() }
  })

  it('report stores a row and sends email', async () => {
    const fixture = await trackingFixture()
    try {
      const app = createApp(fixture.env)
      const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
      const h = (tenant: string, extra: Record<string, string> = {}) => ({ origin: fixture.env.APP_ORIGIN, cookie: fixture.cookies[tenant] ?? '', ...extra })
      const json = (tenant: string, extra: Record<string, string> = {}) => h(tenant, { 'content-type': 'application/json', ...extra })

      const share = await (await app.request('/api/characters/character-a/share', { method: 'PUT', body: JSON.stringify({ style: 'stats', showMoodboard: false, showPlaylist: false, showStats: false, indexable: false }), headers: json('a') }, fixture.env, stubCtx)).json() as { slug: string }

      // Mock fetch for Resend
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // The tracking fixture overrides fetch; keep its behavior for Tumblr and add Resend mock
      const originalFetch = globalThis.fetch
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('api.resend.com')) return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
        return originalFetch(input, init)
      })

      const reportRes = await app.request(`/c/${share.slug}/report`, { method: 'POST', body: JSON.stringify({ reason: 'Inappropriate content' }), headers: { 'content-type': 'application/json' } }, fixture.env, stubCtx)
      expect(reportRes.status).toBe(200)
      const reportHtml = await reportRes.text()
      expect(reportHtml).toContain('Thank you')

      const row = await fixture.env.DB.prepare('SELECT slug,reason FROM share_reports WHERE slug=?').bind(share.slug).first<{ slug: string; reason: string }>()
      expect(row).toBeTruthy()
      expect(row!.reason).toBe('Inappropriate content')

      expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }))
    } finally { await fixture.dispose() }
  })

  it('share settings null for character without share', async () => {
    const fixture = await trackingFixture()
    try {
      const app = createApp(fixture.env)
      const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
      const getRes = await app.request('/api/characters/character-a/share', { headers: { origin: fixture.env.APP_ORIGIN, cookie: fixture.cookies.a } }, fixture.env, stubCtx)
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toBeNull()
    } finally { await fixture.dispose() }
  })
})
