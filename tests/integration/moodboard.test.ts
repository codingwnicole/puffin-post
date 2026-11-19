import { describe, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'
import { createApp } from '../../src/worker'

type Fixture = Awaited<ReturnType<typeof trackingFixture>>
const PNG: BlobPart = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
const JPEG: BlobPart = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const FAKE: BlobPart = new Uint8Array(Array.from({ length: 16 }, (_, i) => i))

function makeApi(fixture: Fixture) {
  const app = createApp(fixture.env)
  const { env, cookies } = fixture
  const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
  const h = (tenant: string, extra: Record<string, string> = {}) => ({ origin: env.APP_ORIGIN, cookie: cookies[tenant] ?? '', ...extra })
  const base = '/api/characters/character-a/moodboard'
  return {
    upload: (bytes: BlobPart = PNG, type = 'image/png', tenant = 'a') => {
      const form = new FormData()
      form.append('image', new File([bytes], 't.png', { type }))
      return app.request(base, { method: 'POST', body: form, headers: h(tenant) }, env, stubCtx)
    },
    list: (tenant = 'a') => app.request(base, { headers: h(tenant) }, env, stubCtx),
    pin: (url: string, tenant = 'a') => app.request(`${base}/pin`, { method: 'POST', body: JSON.stringify({ url }), headers: h(tenant, { 'content-type': 'application/json' }) }, env, stubCtx),
    item: (id: string, tenant = 'a') => app.request(`${base}/${id}/image`, { headers: h(tenant) }, env, stubCtx),
    del: (id: string, tenant = 'a') => app.request(`${base}/${id}`, { method: 'DELETE', headers: h(tenant) }, env, stubCtx),
    order: (ids: string[], tenant = 'a') => app.request(`${base}/order`, { method: 'PUT', body: JSON.stringify({ ids }), headers: h(tenant, { 'content-type': 'application/json' }) }, env, stubCtx),
  }
}

describe('character moodboard and playlist backend', () => {
  it('uploads, lists, serves, reorders, deletes, and enforces workspace + limits', async () => {
    const fixture = await trackingFixture()
    try {
      const api = makeApi(fixture)
      const first = await (await api.upload()).json() as { id: string }
      const second = await (await api.upload(JPEG, 'image/jpeg')).json() as { id: string }
      const pinRes = await api.pin('https://www.pinterest.com/pin/1234567890123/')
      expect(pinRes.status).toBe(201)
      const pinItem = await pinRes.json() as { id: string; kind: string; pinId: string }
      expect(pinItem.kind).toBe('pin')
      expect(pinItem.pinId).toBe('1234567890123')
      expect((await api.pin('https://example.com/x')).status).toBe(400)

      const items = await (await api.list()).json() as { id: string; position: number }[]
      expect(items).toHaveLength(3)
      expect(items.map(i => i.position)).toEqual([0, 1, 2])
      expect(items.map(i => i.id)).toEqual([first.id, second.id, pinItem.id])

      const img = await api.item(first.id)
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toBe('image/png')
      expect(img.headers.get('x-content-type-options')).toBe('nosniff')
      expect(img.headers.get('cache-control')).toBe('private, max-age=300')
      expect((await api.item(pinItem.id)).status).toBe(404)

      expect((await api.order([pinItem.id, second.id, first.id])).status).toBe(204)
      const reordered = await (await api.list()).json() as { id: string }[]
      expect(reordered.map(i => i.id)).toEqual([pinItem.id, second.id, first.id])
      expect((await api.order([first.id, second.id])).status).toBe(400)

      // Tenant b gets 404 on every route for character-a.
      expect((await api.list('b')).status).toBe(404)
      expect((await api.pin('https://www.pinterest.com/pin/1234567890123/', 'b')).status).toBe(404)
      expect((await api.order([first.id], 'b')).status).toBe(404)
      expect((await api.item(first.id, 'b')).status).toBe(404)
      expect((await api.del(first.id, 'b')).status).toBe(404)
      expect((await api.upload(PNG, 'image/png', 'b')).status).toBe(404)

      expect((await api.del(pinItem.id)).status).toBe(204)
      expect((await api.del(pinItem.id)).status).toBe(404)

      for (let i = 0; i < 10; i++) await api.upload()
      expect((await api.upload()).status).toBe(409)
      expect((await api.del(first.id)).status).toBe(204)
    } finally { await fixture.dispose() }
  })

  it('deleting a character removes its moodboard rows', async () => {
    const fixture = await trackingFixture()
    try {
      const api = makeApi(fixture)
      expect((await api.upload(FAKE, 'application/octet-stream')).status).toBe(415)
      await api.upload()
      expect((await (await api.list()).json() as unknown[]).length).toBe(1)
      const { env, cookies } = fixture
      const stubCtx = { waitUntil: (_p: unknown) => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
      expect((await createApp(env).request('/api/characters/character-a', { method: 'DELETE', headers: { origin: env.APP_ORIGIN, cookie: cookies.a } }, env, stubCtx)).status).toBe(200)
    } finally { await fixture.dispose() }
  })

  it('stores canonical playlist/board on the card and rejects bad links', async () => {
    const fixture = await trackingFixture()
    try {
      const card = { theme: 'vamp', nickname: 'Fox', playlistUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', boardUrl: 'https://ca.pinterest.ca/user2/board_name.123', tracklist: ['song one', 'song two'] }
      const saved = await fixture.request('/api/characters/character-a/card', 'PUT', card, 'a')
      expect(saved.status).toBe(200)
      const body = await saved.json() as { playlistUrl: string; boardUrl: string; tracklist: string[] }
      expect(body.playlistUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      expect(body.boardUrl).toBe('https://www.pinterest.com/user2/board_name.123/')
      expect(body.tracklist).toEqual(['song one', 'song two'])
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, playlistUrl: 'https://spotify.link/abc' }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, boardUrl: 'https://example.com/board' }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { theme: 'vamp', playlistUrl: '', boardUrl: '' }, 'a')).status).toBe(200)
    } finally { await fixture.dispose() }
  })
})
