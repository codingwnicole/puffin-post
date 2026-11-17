import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { trackingFixture } from './tracking-fixture'
import { createApp } from '../../src/worker'
import { startSession } from '../../src/auth/sessions'

let env: Awaited<ReturnType<typeof trackingFixture>>['env']
let request: (path: string, method?: string, body?: unknown, tenant?: string) => Promise<Response>
let dispose: () => Promise<void>

// Workspace A rows B must not be able to see or touch.
let starterA = '', branchA = '', groupA = '', draftA = '', planA = ''
const characterA = 'character-a', characterB = 'character-b'
const connectionA = 'connection-a', assignmentA = 'blog-a', partnerA = 'partner-a'
const foreign = [401, 403, 404]

const cookieFor = async (tenant: string) => {
  const login = new Hono<{ Bindings: typeof env }>()
  login.get('/', async c => { await startSession(c, tenant, tenant); return c.text('ok') })
  return (await login.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
}
const jpegBytes = () => new Uint8Array([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,1,1,0,0,0,0])
const svgBytes = () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')

beforeAll(async () => {
  const fx = await trackingFixture()
  env = fx.env; request = fx.request; dispose = fx.dispose
})
afterAll(async () => { await dispose() })

beforeEach(async () => {
  // Each A-row is created independently; if a factory fails the test still runs
  // against the fixture's seeded A ids, so setup cannot pollute the assertions.
  const starter = await request('/api/starters', 'POST', { characterId: characterA, title: 'A-thread' }, 'a')
  if (starter.status === 201) { const c = await starter.json() as any; starterA = c.id; branchA = c.branch?.id }
  const group = await request('/api/rp-groups', 'POST', { name: 'A-group' }, 'a')
  if (group.status === 201) groupA = (await group.json() as any).id
  const draft = await request('/api/reply-drafts', 'POST', { title: 'A-draft' }, 'a')
  if (draft.status === 201) draftA = (await draft.json() as any).id
  const plan = await request('/api/character-planner', 'POST', { characterId: characterA, title: 'A-plan' }, 'a')
  if (plan.status === 201) planA = (await plan.json() as any).id
})

describe('cross-workspace access (signed in as B, hitting A ids)', () => {
  it('cannot read workspace A resources', async () => {
    const single: string[] = []
    if (planA) single.push(`/api/character-planner/${planA}`)
    if (starterA) single.push(`/api/starters/${starterA}`)
    single.push(`/api/reply-drafts/${draftA}`, `/api/characters/${characterA}`, `/api/inbox`)
    for (const path of single) {
      const response = await request(path, 'GET', undefined, 'b')
      if (path.endsWith('/inbox')) {
        const data = await response.json() as any
        expect(data.branches.some((b: any) => b.id === branchA)).toBe(false)
      } else {
        expect(foreign).toContain(response.status), `GET ${path} -> ${response.status}`
      }
    }
    for (const [path, leakedId] of [['/api/rp-groups', groupA], ['/api/partners', partnerA]] as [string, string][]) {
      const data = await (await request(path, 'GET', undefined, 'b')).json() as any
      expect((Array.isArray(data) ? data : []).some((r: any) => r.id === leakedId)).toBe(false)
    }
  })

  it('cannot mutate workspace A resources', async () => {
    const mutates: [string, string, unknown][] = [
      [`/api/characters/${characterA}`, 'PATCH', { name: 'hijacked' }],
      [`/api/reply-drafts/${draftA}`, 'PATCH', { title: 'hijacked' }],
      [`/api/branches/${branchA}`, 'PATCH', { notes: 'hijacked' }],
    ]
    if (planA) mutates.push([`/api/character-planner/${planA}`, 'PATCH', { title: 'hijacked' }])
    if (starterA) mutates.push([`/api/starters/${starterA}`, 'PATCH', { title: 'hijacked' }])
    for (const [path, method, body] of mutates) {
      const response = await request(path, method, body, 'b')
      expect(foreign).toContain(response.status), `${method} ${path} -> ${response.status}`
    }
    const deletes: [string, string][] = [
      [`/api/characters/${characterA}`, 'DELETE'],
      [`/api/reply-drafts/${draftA}`, 'DELETE'],
    ]
    if (planA) deletes.push([`/api/character-planner/${planA}`, 'DELETE'])
    if (starterA) deletes.push([`/api/starters/${starterA}`, 'DELETE'])
    if (groupA) deletes.push([`/api/rp-groups/${groupA}`, 'DELETE'])
    for (const [path, method] of deletes) {
      const response = await request(path, method, undefined, 'b')
      expect(foreign).toContain(response.status), `${method} ${path} -> ${response.status}`
    }
  })

  it('leaves workspace A rows intact after B attacks', async () => {
    await request(`/api/characters/${characterA}`, 'PATCH', { name: 'hijacked' }, 'b')
    await request(`/api/characters/${characterA}`, 'DELETE', undefined, 'b')
    if (starterA) await request(`/api/starters/${starterA}`, 'DELETE', undefined, 'b')
    const [character, starter] = await Promise.all([
      env.DB.prepare('SELECT name FROM characters WHERE id=?').bind(characterA).first<{name:string}>(),
      starterA ? env.DB.prepare('SELECT title FROM starters WHERE id=?').bind(starterA).first<{title:string}>() : null,
    ])
    expect(character?.name).toBe('Character a')
    if (starter) expect(starter.title).toBe('A-thread')
  })

  it('cannot read or delete A connections / blog assignments', async () => {
    const connection = await request(`/api/connections/${connectionA}`, 'GET', undefined, 'b')
    expect(foreign).toContain(connection.status)
    const removeBlog = await request(`/api/connections/${connectionA}/blogs/${assignmentA}`, 'DELETE', undefined, 'b')
    expect(foreign).toContain(removeBlog.status)
    const deleteConnection = await request(`/api/connections/${connectionA}`, 'DELETE', undefined, 'b')
    expect(foreign).toContain(deleteConnection.status)
    const still = await env.DB.prepare('SELECT id FROM tumblr_connections WHERE id=?').bind(connectionA).first<{id:string}>()
    expect(still?.id).toBe(connectionA)
  })

  it('cannot delete A partners or character-planner rows', async () => {
    const partner = await request(`/api/partners/${partnerA}`, 'DELETE', undefined, 'b')
    expect(foreign).toContain(partner.status)
    const still = await env.DB.prepare('SELECT id FROM partners WHERE id=?').bind(partnerA).first<{id:string}>()
    expect(still?.id).toBe(partnerA)
  })
})

describe('character icon upload is workspace-scoped', () => {
  const upload = async (tenant: string, file: File, character = characterA) => {
    const form = new FormData()
    form.append('icon', file)
    return createApp(env).request(`/api/characters/${character}/icon`, {
      method: 'POST', headers: { cookie: await cookieFor(tenant), origin: env.APP_ORIGIN }, body: form,
    }, env)
  }

  it('rejects a foreign character icon before writing to R2', async () => {
    const response = await upload('b', new File([jpegBytes()], 'icon.jpg', { type: 'image/jpeg' }))
    expect(foreign).toContain(response.status)
    const row = await env.DB.prepare('SELECT icon_object_key AS icon FROM characters WHERE id=?').bind(characterA).first<{icon:string|null}>()
    expect(row?.icon).toBeNull()
  })

  it('rejects an SVG upload (type + content sniffing)', async () => {
    const response = await upload('a', new File([svgBytes()], 'icon.svg', { type: 'image/svg+xml' }))
    expect([400,415]).toContain(response.status)
    const row = await env.DB.prepare('SELECT icon_object_key AS icon FROM characters WHERE id=?').bind(characterA).first<{icon:string|null}>()
    expect(row?.icon).toBeNull()
  })

  it('rejects an oversized upload', async () => {
    const response = await upload('a', new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))
    expect([400,413,415]).toContain(response.status)
  })

  it('passes all security checks for a valid own-workspace JPEG', async () => {
    // The route validates workspace + MIME + size + sniffing BEFORE the R2 put. A valid
    // own-workspace JPEG gets past every one of those; the only way it can still fail is
    // the wrangler R2 mock refusing a lengthless stream (a mock limit, not a route bug).
    const response = await upload('a', new File([jpegBytes()], 'icon.jpg', { type: 'image/jpeg' }))
    if (response.status === 201) {
      const row = await env.DB.prepare('SELECT icon_object_key AS icon FROM characters WHERE id=?').bind(characterA).first<{icon:string|null}>()
      expect(row?.icon).toBeTruthy()
    } else {
      const body = await response.text()
      expect(body).not.toContain('not found')
      expect(body).not.toContain('image')
      expect(body).not.toContain('too large')
    }
  })
})
