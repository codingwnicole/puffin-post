import { readdir, readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { hashToken, randomToken } from '../../src/auth/sessions'
import { createApp, type Env } from '../../src/worker'
import { sqlStatements } from './sql-statements'

describe('site roadmap access and administration', () => {
  let env: Env
  let dispose: () => Promise<void>

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    env = { ...platform.env, APP_ORIGIN: 'https://rpthreadbuddy.app', SESSION_SECRET: 'test-only-session-secret-with-32-characters', MODERATOR_USER_ID: 'admin' }
    dispose = platform.dispose
    for (const file of (await readdir('src/db/migrations')).sort()) {
      const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
      await env.DB.batch(sqlStatements(sql).map(part => env.DB.prepare(part)))
    }
    for (const [id, role] of [['admin', 'owner'], ['member', 'member']] as const) {
      await env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)')
        .bind(id, `${id}@example.com`, id, `email:${id}@example.com`).run()
      if (id === 'admin') await env.DB.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind('home', 'Home', 'admin').run()
      await env.DB.prepare('INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,?)').bind('home', id, role).run()
    }
  }, 30_000)

  afterEach(async () => { await dispose?.() })

  async function cookieFor(userId: string) {
    const token = randomToken()
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))
    const signed = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
    await env.DB.prepare('INSERT INTO sessions (id_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)')
      .bind(await hashToken(token), userId, 'home', new Date(Date.now() + 60_000).toISOString()).run()
    return `__Host-threadums_session=${token}.${signed}`
  }

  function request(path: string, method = 'GET', body?: object, cookie?: string) {
    return createApp(env).request(path, {
      method,
      headers: { origin: env.APP_ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, env)
  }

  it('allows public read access while limiting create, edit, ordering, and delete to the moderator', async () => {
    const guestRead = await request('/api/roadmap')
    expect(guestRead.status).toBe(200)
    expect(await guestRead.json()).toMatchObject({ items: [], canManage: false })

    const memberCookie = await cookieFor('member')
    expect((await request('/api/roadmap', 'POST', { title: 'Not approved', description: 'No.', status: 'planned' }, memberCookie)).status).toBe(403)
    const memberRead = await request('/api/roadmap', 'GET', undefined, memberCookie)
    expect(await memberRead.json()).toMatchObject({ canManage: false, items: [] })

    const adminCookie = await cookieFor('admin')
    const first = await request('/api/roadmap', 'POST', { title: 'Tumblr tracking', description: 'Improve thread discovery.', status: 'planned' }, adminCookie)
    const second = await request('/api/roadmap', 'POST', { title: 'Accessibility', description: 'Keep improving keyboard and mobile access.', status: 'considering' }, adminCookie)
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const ids = await Promise.all([first.json(), second.json()]) as Array<{ id: string }>
    expect((await request(`/api/roadmap/${ids[1].id}`, 'PATCH', { move: -1 }, adminCookie)).status).toBe(200)
    expect((await request(`/api/roadmap/${ids[0].id}`, 'PATCH', { status: 'in_progress' }, adminCookie)).status).toBe(200)

    const listed = await request('/api/roadmap', 'GET', undefined, adminCookie)
    const data = await listed.json() as { items: Array<{ id: string; status: string }>; canManage: boolean }
    expect(data.canManage).toBe(true)
    expect(data.items.map(item => item.id)).toEqual([ids[1].id, ids[0].id])
    expect(data.items[1].status).toBe('in_progress')
    expect((await request(`/api/roadmap/${ids[1].id}`, 'DELETE', undefined, adminCookie)).status).toBe(204)
  })

  it('stores an optional icon from the allowed set, and rejects unknown icons', async () => {
    const adminCookie = await cookieFor('admin')
    const created = await request('/api/roadmap', 'POST', { title: 'Discord bot', description: 'Post updates to Discord.', status: 'planned', icon: 'chat' }, adminCookie)
    expect(created.status).toBe(201)
    const { id } = await created.json() as { id: string }
    const plain = await request('/api/roadmap', 'POST', { title: 'No icon yet', description: 'Older clients send no icon.', status: 'planned' }, adminCookie)
    expect(plain.status).toBe(201)
    expect((await request(`/api/roadmap/${id}`, 'PATCH', { icon: 'bot' }, adminCookie)).status).toBe(200)
    expect((await request(`/api/roadmap/${id}`, 'PATCH', { icon: '<script>' }, adminCookie)).status).toBe(400)
    const { items } = await (await request('/api/roadmap')).json() as { items: Array<{ title: string; icon: string | null }> }
    expect(items.map(item => [item.title, item.icon])).toEqual([['Discord bot', 'bot'], ['No icon yet', null]])
  })

  it('requires authentication for roadmap changes even though reading is public', async () => {
    const response = await request('/api/roadmap', 'POST', { title: 'Planned item', description: 'Must not be anonymous.', status: 'planned' })
    expect(response.status).toBe(401)
  })
})
