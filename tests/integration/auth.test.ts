import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { createApp, type Env } from '../../src/worker'
import { createMagicLinks, type MailSender } from '../../src/auth/magic-links'
import { createInvite } from '../../src/auth/invites'

describe('invite-only authentication against local D1', () => {
  let env: Env
  let dispose: () => Promise<void>
  let sent: { to: string; url: string }[]
  let mail: MailSender

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters' }
    dispose = platform.dispose
    for (const file of ['0001_initial.sql', '0002_auth.sql']) {
      const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
      await env.DB.batch(sql.split(';').filter((part) => part.trim()).map((part) => env.DB.prepare(part)))
    }
    await env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('owner','owner@example.com','Owner','email:owner@example.com')").run()
    await env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('home','Home','owner')").run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('home','owner','owner')").run()
    sent = []
    mail = { async send(message) { sent.push(message) } }
  }, 30_000)

  afterEach(async () => { await dispose?.() })

  function request(path: string, body?: object | null, cookie?: string, origin = env.APP_ORIGIN) {
    return createApp(env, { mailSender: mail }).request(path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, env)
  }

  async function login() {
    await request('/api/auth/magic-link', { email: 'owner@example.com' })
    const response = await confirmMagicLink(sent.at(-1)!.url)
    expect(response.status).toBe(302)
    return response.headers.get('set-cookie')!.split(';')[0]
  }

  async function confirmMagicLink(link: string, cookie?: string) {
    const url = new URL(link)
    const page = await request(url.pathname + url.search, undefined, cookie)
    if (page.status !== 200) return page
    return createApp(env, { mailSender: mail }).request('/api/auth/verify', {
      method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams({ token: url.searchParams.get('token')! }),
    }, env)
  }

  it('does not establish or replace a session on cross-site magic-link navigation', async () => {
    const victim = await login()
    await env.DB.prepare("INSERT INTO users (id,email,display_name,auth_identity) VALUES ('attacker','attacker@example.com','Attacker','email:attacker@example.com')").run()
    await env.DB.prepare("INSERT INTO workspaces (id,name,owner_user_id) VALUES ('attacker','Attacker','attacker')").run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES ('attacker','attacker','owner')").run()
    const token = await createMagicLinks(env, mail).issueMagicLink('attacker@example.com')
    for (const cookie of [undefined, victim]) {
      const response = await createApp(env, { mailSender: mail }).request(`/api/auth/verify?token=${token}`, {
        headers: { ...(cookie ? { cookie } : {}), 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', referer: 'https://evil.test/' },
      }, env)
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(await response.text()).toContain('attacker@example.com')
    }
    expect(await (await request('/api/auth/session', undefined, victim)).json()).toMatchObject({ userId: 'owner', workspaceId: 'home' })
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').first<{ n: number }>())!.n).toBe(1)
    expect((await env.DB.prepare("SELECT consumed_at FROM magic_links WHERE email='attacker@example.com'").first<{ consumed_at: string | null }>())!.consumed_at).toBeNull()
  })

  it('redeems only after a deliberate confirmation POST and rejects replay', async () => {
    const token = await createMagicLinks(env, mail).issueMagicLink('owner@example.com')
    const page = await request(`/api/auth/verify?token=${token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'")
    const html = await page.text()
    expect(html).toContain('owner@example.com')
    expect(html).toContain('method="post"')
    expect(html).toContain('action="/api/auth/verify"')
    expect(html).not.toContain('<script')
    const crossSite = await createApp(env, { mailSender: mail }).request('/api/auth/verify', {
      method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }, env)
    expect(crossSite.status).toBe(403)
    expect(crossSite.headers.get('set-cookie')).toBeNull()
    const accepted = await createApp(env, { mailSender: mail }).request('/api/auth/verify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }, env)
    expect(accepted.status).toBe(302)
    expect(accepted.headers.get('location')).toBe('/')
    expect((await request('/api/auth/session', undefined, accepted.headers.get('set-cookie')!.split(';')[0])).status).toBe(200)
    const replay = await createApp(env, { mailSender: mail }).request('/api/auth/verify', {
      method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }, env)
    expect(replay.status).toBe(400)
    expect(replay.headers.get('set-cookie')).toBeNull()
    expect((await request(`/api/auth/verify?token=${token}`)).status).toBe(400)
  })

  it('preserves no-store and no-referrer on successful callbacks and 400 401 403 errors', async () => {
    await request('/api/auth/magic-link', { email: 'owner@example.com' })
    const url = new URL(sent.at(-1)!.url)
    const responses = [
      await confirmMagicLink(url.toString()),
      await request('/api/auth/verify?token=bad'),
      await request('/api/auth/session'),
      await request('/api/auth/sign-out', {}, undefined, 'https://evil.test'),
    ]
    expect(responses.map((response) => response.status)).toEqual([302, 400, 401, 403])
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    }
  })

  it('rejects reused, expired and concurrent magic links and stores only hashes', async () => {
    const links = createMagicLinks(env, mail)
    const token = await links.issueMagicLink('owner@example.com')
    const row = await env.DB.prepare('SELECT token_hash FROM magic_links').first<{ token_hash: string }>()
    expect(row!.token_hash).not.toBe(token)
    expect(row!.token_hash).toMatch(/^[a-f0-9]{64}$/)
    const results = await Promise.allSettled([links.consumeMagicLink(token), links.consumeMagicLink(token)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await expect(links.consumeMagicLink(token)).rejects.toThrow('invalid magic link')
    const expired = await links.issueMagicLink('owner@example.com')
    await env.DB.prepare("UPDATE magic_links SET expires_at = '2000-01-01T00:00:00.000Z'").run()
    await expect(links.consumeMagicLink(expired)).rejects.toThrow('invalid magic link')
  })

  it('does not register strangers or disclose which emails have accounts', async () => {
    const unknown = await request('/api/auth/magic-link', { email: 'stranger@example.com' })
    const known = await request('/api/auth/magic-link', { email: 'owner@example.com' })
    expect(unknown.status).toBe(202)
    expect(await unknown.json()).toEqual(await known.json())
    expect(sent.map((message) => message.to)).toEqual(['owner@example.com'])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1)
  })

  it('creates secure signed sessions, rejects tampering and invalidates logout', async () => {
    await request('/api/auth/magic-link', { email: 'owner@example.com' })
    const url = new URL(sent[0].url)
    const response = await confirmMagicLink(url.toString())
    const header = response.headers.get('set-cookie')!
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    const cookie = header.split(';')[0]
    expect((await request('/api/auth/session', undefined, cookie)).status).toBe(200)
    expect((await request('/api/auth/session', undefined, cookie + 'x')).status).toBe(401)
    const forged = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
    expect((await request('/api/auth/session', undefined, forged)).status).toBe(401)
    expect((await request('/api/auth/session')).status).toBe(401)
    expect((await request('/api/auth/sign-out', {}, cookie)).status).toBe(204)
    expect((await request('/api/auth/session', undefined, cookie)).status).toBe(401)
  })

  it('provisions only the secret-designated first owner, then remains invite-only', async () => {
    await env.DB.batch(['sessions', 'magic_links', 'memberships', 'workspaces', 'users'].map(table => env.DB.prepare(`DELETE FROM ${table}`)))
    env.BOOTSTRAP_OWNER_EMAIL = 'first@example.com'
    const first = await request('/api/auth/magic-link', { email: 'first@example.com' })
    const stranger = await request('/api/auth/magic-link', { email: 'stranger@example.com' })
    expect(first.status).toBe(202)
    expect(stranger.status).toBe(202)
    expect(sent.map(message => message.to)).toEqual(['first@example.com'])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>())!.n).toBe(1)
    expect((await confirmMagicLink(sent[0].url)).status).toBe(302)
    await request('/api/auth/magic-link', { email: 'another@example.com' })
    expect(sent.map(message => message.to)).toEqual(['first@example.com'])
  })

  it('expires sessions and rejects cross-origin state changes', async () => {
    const cookie = await login()
    expect((await request('/api/auth/sign-out', {}, cookie, 'https://evil.test')).status).toBe(403)
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run()
    expect((await request('/api/auth/session', undefined, cookie)).status).toBe(401)
  })

  it('rotates the existing session when another sign-in link is accepted', async () => {
    const previous = await login()
    await request('/api/auth/magic-link', { email: 'owner@example.com' })
    const url = new URL(sent.at(-1)!.url)
    const response = await confirmMagicLink(url.toString(), previous)
    const headers = response.headers.get('set-cookie')!
    expect(headers.match(/__Host-threadums_session=/g)).toHaveLength(1)
    const current = headers.split(';')[0]
    expect((await request('/api/auth/session', undefined, current)).status).toBe(200)
    expect((await request('/api/auth/session', undefined, previous)).status).toBe(401)
  })

  it('denies a sign-in link if membership was revoked after issuance', async () => {
    await request('/api/auth/magic-link', { email: 'owner@example.com' })
    await env.DB.prepare("DELETE FROM memberships WHERE user_id='owner'").run()
    const url = new URL(sent.at(-1)!.url)
    expect((await confirmMagicLink(url.toString())).status).toBe(403)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())!.n).toBe(0)
  })

  it('rejects malformed JSON values with a client error', async () => {
    expect((await request('/api/auth/magic-link', null)).status).toBe(400)
    const cookie = await login()
    const response = await createApp(env, { mailSender: mail }).request('/api/workspaces/home/invites', {
      method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', cookie }, body: 'null',
    }, env)
    expect(response.status).toBe(400)
  })

  it('provisions a beta invite into only the recipient private workspace', async () => {
    const cookie = await login()
    const response = await request('/api/workspaces/home/invites', { email: 'New@Example.com' }, cookie)
    expect(response.status).toBe(201)
    expect(sent.at(-1)!.to).toBe('new@example.com')
    const url = new URL(sent.at(-1)!.url)
    const accepted = await confirmMagicLink(url.toString())
    expect(accepted.status).toBe(302)
    const member = await env.DB.prepare("SELECT m.workspace_id, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='new@example.com'").all<{ workspace_id: string; role: string }>()
    expect(member.results).toHaveLength(1)
    expect(member.results[0].workspace_id).not.toBe('home')
    expect(member.results[0].role).toBe('owner')
    expect((await request(url.pathname + url.search)).status).toBe(400)
    expect((await request('/api/auth/session', undefined, accepted.headers.get('set-cookie')!.split(';')[0])).status).toBe(200)
  })

  it('adds only the explicitly invited shared membership', async () => {
    const invite = await createInvite({ db: env.DB, userId: 'owner', workspaceId: 'home', email: 'shared@example.com', kind: 'shared' })
    const links = createMagicLinks(env, mail)
    await links.sendMagicLink('shared@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })
    const url = new URL(sent.at(-1)!.url)
    expect((await confirmMagicLink(url.toString())).status).toBe(302)
    expect((await env.DB.prepare("SELECT m.workspace_id,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='shared@example.com'").all()).results)
      .toEqual([{ workspace_id: 'home', role: 'member' }])
  })

  it('provisions only once when two emailed links redeem the same beta invite concurrently', async () => {
    const invite = await createInvite({ db: env.DB, userId: 'owner', workspaceId: 'home', email: 'new@example.com' })
    const links = createMagicLinks(env, mail)
    await links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })
    await links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })
    const responses = await Promise.all(sent.map(({ url }) => {
      const parsed = new URL(url)
      return confirmMagicLink(parsed.toString())
    }))
    expect(responses.map((response) => response.status).sort()).toEqual([302, 400])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>())!.n).toBe(2)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='new@example.com'").first<{ n: number }>())!.n).toBe(1)
    await expect(links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })).rejects.toThrow('invalid invite')
  })

  it('invalidates a token when delivery fails', async () => {
    const links = createMagicLinks(env, { async send() { throw new Error('mail unavailable') } })
    await expect(links.sendMagicLink('owner@example.com', 'sign_in')).rejects.toThrow('mail unavailable')
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM magic_links').first<{ n: number }>())!.n).toBe(0)
  })

  it('rejects mismatched-email, expired, reused and cross-workspace invites', async () => {
    const invite = await createInvite({ db: env.DB, userId: 'owner', workspaceId: 'home', email: 'new@example.com', kind: 'shared' })
    const links = createMagicLinks(env, mail)
    await expect(links.sendMagicLink('other@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })).rejects.toThrow('invalid invite')
    await expect(links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'other' })).rejects.toThrow('invalid invite')
    await links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })
    await env.DB.prepare("UPDATE invites SET expires_at='2000-01-01T00:00:00.000Z'").run()
    const url = new URL(sent[0].url)
    expect((await confirmMagicLink(url.toString())).status).toBe(400)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email='new@example.com'").first<{ n: number }>())!.n).toBe(0)
    await expect(links.sendMagicLink('new@example.com', 'accept_invite', { inviteToken: invite.token, workspaceId: 'home' })).rejects.toThrow('invalid invite')
  })

  it('requires current owner membership to issue invites', async () => {
    const cookie = await login()
    expect((await request('/api/workspaces/other/invites', { email: 'new@example.com' }, cookie)).status).toBe(403)
    await env.DB.prepare("UPDATE memberships SET role='member' WHERE user_id='owner'").run()
    expect((await request('/api/workspaces/home/invites', { email: 'new@example.com' }, cookie)).status).toBe(403)
    expect((await request('/api/workspaces/home/invites', { email: 'new@example.com' })).status).toBe(401)
  })
})
