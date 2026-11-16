import { afterEach, beforeEach, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { runRefreshBatch } from '../../src/refresh/runner'
import { encryptToken } from '../../src/tumblr/oauth'
import type { Env } from '../../src/worker'

type Stub = {
  env: Env
  fetchCount: number
  notesFor: (rootPostId: string) => unknown[]
  notesFailFor?: (rootPostId: string) => boolean
  dispose: () => Promise<void>
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function migrate(db: Env['DB']): Promise<void> {
  for (const file of (await readdir('src/db/migrations')).sort()) {
    const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
    await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)))
  }
}

// Builds an isolated D1 env with N character blogs, each owning one starter
// root post, and a URL-aware fetch stub that counts every outbound call.
// `notesFor` decides the reblog-chain a thread-notes call returns.
async function makeStub(n: number, notesFor: (rootPostId: string) => unknown[], notesFailFor?: (rootPostId: string) => boolean): Promise<Stub> {
  const platform = await getPlatformProxy<Env>({ persist: false })
  const env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters',
    TOKEN_ENCRYPTION_KEY: 'test-only-encryption-key-with-32-chars', TUMBLR_CONSUMER_KEY: 'key', TUMBLR_CONSUMER_SECRET: 'secret' } as Env
  await migrate(env.DB)
  const cipher = await encryptToken('token', env.TOKEN_ENCRYPTION_KEY)
  const stmts = []
  for (let i = 0; i < n; i++) {
    const id = `w${i}`
    stmts.push(
      env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)').bind(id, `${id}@example.com`, id, id),
      env.DB.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind(id, id, id),
      env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,?)").bind(id, id, 'owner'),
      env.DB.prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)').bind(`ch-${i}`, id, `Char ${i}`),
      env.DB.prepare('INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES (?,?,?,?)').bind(`pa-${i}`, id, `p${i}.tumblr.com`, `P ${i}`),
      env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind(`tc-${i}`, id, cipher, cipher, JSON.stringify({ blogs: [`${id}.tumblr.com`] })),
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)').bind(`cb-${i}`, id, `ch-${i}`, `tc-${i}`, `${id}.tumblr.com`, id),
      env.DB.prepare('INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id) VALUES (?,?,?,?,?,?,?)').bind(`st-${i}`, id, `ch-${i}`, `Thread ${i}`, 'tumblr', `${i + 100}`, `${id}.tumblr.com`),
      env.DB.prepare('INSERT INTO reply_branches (id,workspace_id,starter_id,partner_id) VALUES (?,?,?,?)').bind(`br-${i}`, id, `st-${i}`, `pa-${i}`),
    )
  }
  await env.DB.batch(stmts)
  const fetchCount = { n: 0 }
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    fetchCount.n += 1
    const notes = /\/blog\/[^/]+\/notes\?id=(\d+)/.exec(url)
    if (notes) {
      const rootPostId = notes[1]
      if (notesFailFor?.(rootPostId)) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
      return jsonResponse({ response: { notes: notesFor(rootPostId) } })
    }
    if (url.includes('/user/info')) return jsonResponse({ response: { user: { blogs: [] } } })
    if (url.includes('/v2/blog/')) return jsonResponse({ response: { notes: [] } })
    return jsonResponse({ response: {} })
  }
  return { env, get fetchCount() { return fetchCount.n }, notesFor, notesFailFor, dispose: async () => { await platform.dispose() } }
}

let cleanup: (() => void)[] = []
beforeEach(() => { cleanup = [] })
afterEach(async () => {
  globalThis.fetch = fetch
  for (const fn of cleanup) await fn()
  cleanup = []
})

// (a) 30 due branches: one run stays well under the subrequest cap and the
// next run picks up where the first one stopped (rotated cursor).
it('keeps a 30-branch batch under the subrequest cap and resumes on the next run', async () => {
  const stub = await makeStub(30, () => [])
  cleanup.push(stub.dispose)
  const t = new Date('2026-01-01T00:00:00Z')
  const r1 = await runRefreshBatch(stub.env, t, 30)
  expect(r1.selected).toBe(30)
  expect(r1.refreshed).toBeGreaterThanOrEqual(1)
  expect(r1.fetchesUsed).toBeLessThanOrEqual(45)
  expect(stub.fetchCount).toBeLessThanOrEqual(45)
  const r2 = await runRefreshBatch(stub.env, new Date('2026-01-01T00:30:00Z'), 30)
  expect(r2.refreshed).toBeGreaterThanOrEqual(1)
  expect(r2.fetchesUsed).toBeLessThanOrEqual(45)
  expect(r1.refreshed + r2.refreshed).toBeGreaterThanOrEqual(2)
})

// (b) A manual override older than new activity yields: status updates and the
// override clears.
it('lets a manual override yield to newer Tumblr activity', async () => {
  const stub = await makeStub(1, () => [{ type: 'reblog', blog_name: 'p0', post_id: 'reply-1', reblog_parent_blog_name: 'w0', timestamp: Date.parse('2026-01-05T00:00:00Z') / 1000 }])
  cleanup.push(stub.dispose)
  await stub.env.DB.prepare("UPDATE reply_branches SET status='your_turn', status_manual_override_at='2026-01-01T00:00:00.000Z' WHERE id='br-0'").run()
  await runRefreshBatch(stub.env, new Date('2026-01-06T00:00:00Z'), 10)
  const row = await stub.env.DB.prepare('SELECT status,status_manual_override_at AS o FROM reply_branches WHERE id=\'br-0\'').first<{ status: string; o: string | null }>()
  expect(row!.status).toBe('your_turn')
  expect(row!.o).toBeNull()
})

// (c) A manual override newer than the latest activity holds: status is kept.
it('keeps a manual override that is newer than the latest activity', async () => {
  const stub = await makeStub(1, () => [{ type: 'reblog', blog_name: 'w0', post_id: 'reblog-1', reblog_parent_blog_name: 'p0', timestamp: Date.parse('2026-01-01T00:00:00Z') / 1000 }])
  cleanup.push(stub.dispose)
  await stub.env.DB.prepare("UPDATE reply_branches SET status='queued', status_manual_override_at='2026-01-05T00:00:00.000Z' WHERE id='br-0'").run()
  await runRefreshBatch(stub.env, new Date('2026-01-06T00:00:00Z'), 10)
  const row = await stub.env.DB.prepare('SELECT status,status_manual_override_at AS o FROM reply_branches WHERE id=\'br-0\'').first<{ status: string; o: string | null }>()
  expect(row!.status).toBe('queued')
  expect(row!.o).toBe('2026-01-05T00:00:00.000Z')
})

// (d) The user's own reblog is newest: the thread flips to their_turn.
it('flips to their_turn when the user reblogs the partner reply', async () => {
  const stub = await makeStub(1, () => [
    { type: 'reblog', blog_name: 'p0', post_id: 'partner-reply', reblog_parent_blog_name: 'w0', timestamp: Date.parse('2026-01-01T00:00:00Z') / 1000 },
    { type: 'reblog', blog_name: 'w0', post_id: 'user-reblog', reblog_parent_blog_name: 'p0', timestamp: Date.parse('2026-01-03T00:00:00Z') / 1000 },
  ])
  cleanup.push(stub.dispose)
  await stub.env.DB.prepare("UPDATE reply_branches SET status='your_turn' WHERE id='br-0'").run()
  await runRefreshBatch(stub.env, new Date('2026-01-04T00:00:00Z'), 10)
  const row = await stub.env.DB.prepare('SELECT status FROM reply_branches WHERE id=\'br-0\'').first<{ status: string }>()
  expect(row!.status).toBe('their_turn')
})

// (e) One branch's Tumblr call fails: its siblings still update.
it('keeps updating other branches when one branch Tumblr call fails', async () => {
  const stub = await makeStub(3, rootPostId => rootPostId === '100' ? [{ type: 'reblog', blog_name: 'p0', post_id: 'reply-0', reblog_parent_blog_name: 'w0', timestamp: 100 }] : rootPostId === '102' ? [{ type: 'reblog', blog_name: 'p2', post_id: 'reply-2', reblog_parent_blog_name: 'w2', timestamp: 100 }] : [], rootPostId => rootPostId === '101')
  cleanup.push(stub.dispose)
  await runRefreshBatch(stub.env, new Date('2026-01-01T00:00:00Z'), 10)
  const failed = await stub.env.DB.prepare('SELECT id FROM reply_branches WHERE id=\'br-1\' AND refresh_error IS NOT NULL').first<{ id: string }>()
  const updated = await stub.env.DB.prepare('SELECT id FROM reply_branches WHERE id=\'br-2\' AND latest_post_id=\'reply-2\'').first<{ id: string }>()
  expect(failed).toMatchObject({ id: 'br-1' })
  expect(updated).toMatchObject({ id: 'br-2' })
})
