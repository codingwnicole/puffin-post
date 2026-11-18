import { describe, expect, it, vi } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { encryptToken } from '../../src/tumblr/oauth'
import { runRefreshBatch } from '../../src/refresh/runner'
import type { Env } from '../../src/worker'

const ENC_KEY = 'test-only-encryption-key-with-32-chars'

async function makeEnv(overrides: Partial<Env> = {}) {
  const originalFetch = globalThis.fetch
  const platform = await getPlatformProxy<Env>({ persist: false })
  const env = {
    ...platform.env,
    APP_ORIGIN: 'https://threadums.test',
    SESSION_SECRET: 'test-only-session-secret-with-32-characters',
    TOKEN_ENCRYPTION_KEY: ENC_KEY,
    TUMBLR_CONSUMER_KEY: 'key',
    TUMBLR_CONSUMER_SECRET: 'secret',
    PUSH_VAPID_PRIVATE_KEY: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"JXgCxPgYUtadtk0TwmuUm_qd-NxNRlQUfBl6KBSFMNU","y":"YDGIjN3al97anLp-WrLAq1s2nxOilt5Wef9QUg1l9TA","crv":"P-256","d":"0ire0gqcqi5Wt5BcHJFyF4mZhbzf5boj9qzGotSXS5k"}',
    ...overrides,
  }
  for (const file of (await readdir('src/db/migrations')).sort()) {
    const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
    await env.DB.batch(sql.split(';').filter(s => s.trim()).map(s => env.DB.prepare(s)))
  }
  return { env, dispose: async () => { globalThis.fetch = originalFetch; await platform.dispose() }, originalFetch }
}

async function seedBase(db: D1Database, workspaceId: string, connId: string, blogId: string, characterId: string) {
  await db.batch([
    db.prepare('INSERT INTO users (id, email, display_name, auth_identity) VALUES (?,?,?,?)').bind('u-' + workspaceId, workspaceId + '@e.com', 'U', 'sha256:' + workspaceId),
  ])
  await db.batch([
    db.prepare('INSERT INTO workspaces (id, name, owner_user_id) VALUES (?,?,?)').bind(workspaceId, 'W', 'u-' + workspaceId),
    db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?,?, 'owner')").bind(workspaceId, 'u-' + workspaceId),
    db.prepare('INSERT INTO characters (id, workspace_id, name) VALUES (?,?,?)').bind(characterId, workspaceId, 'C'),
  ])
  const cipher = await encryptToken('tok', ENC_KEY)
  await db.batch([
    db.prepare('INSERT INTO tumblr_connections (id, workspace_id, token_encrypted, token_secret_encrypted, account_metadata_json) VALUES (?,?,?,?,?)').bind(connId, workspaceId, cipher, cipher, JSON.stringify({ blogs: [blogId] })),
    db.prepare('INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES (?,?,?,?,?,?)').bind('cb-' + characterId + blogId, workspaceId, characterId, connId, blogId, blogId),
  ])
}

function addPartner(db: D1Database, ws: string, id: string, blog: string) {
  return db.prepare('INSERT INTO partners (id, workspace_id, blog_identifier, display_label) VALUES (?,?,?,?)').bind(id, ws, blog, blog).run()
}

function addStarter(db: D1Database, ws: string, char: string, id: string, root: string, blog: string) {
  return db.prepare('INSERT INTO starters (id, workspace_id, character_id, title, source, root_post_id, root_blog_id) VALUES (?,?,?,?,?,?,?)').bind(id, ws, char, 'S' + id, 'tumblr', root, blog).run()
}

function addBranch(db: D1Database, ws: string, starterId: string, partnerId: string, blog: string, status = 'their_turn') {
  return db.prepare('INSERT INTO reply_branches (id, workspace_id, starter_id, partner_id, latest_post_id, last_poster, last_activity_at, status) VALUES (?,?,?,?,?,?,?,?)').bind('b-' + starterId, ws, starterId, partnerId, 'post-' + blog, blog, new Date(0).toISOString(), status).run()
}

function post(id: string, blog: string, rootId: string, rootBlog: string) {
  return { id, blog_name: blog, reblog_key: 'k', state: 'published', format: 'html', timestamp: '2026-11-14T12:00:00Z', date: '2026-11-14 12:00:00 UTC', type: 'text', tags: [], reblogged_from_blog: blog, reblogged_from_root_blog: rootBlog, root_blog: rootBlog, root_id: rootId, reblogged: 0, notes_count: 1, photo_url: 'http://r.tumblr.com/' + id, url: 'http://r.tumblr.com/' + id }
}

function mockTumblr(fetchSpy: any, opts: { mentionsPerBlog?: number; notesByRoot?: Record<string, any[]>; postPreviews?: Record<string, string | null> } = {}) {
  const { mentionsPerBlog = 0, notesByRoot = {}, postPreviews = {} } = opts
  let notesCalls = 0
  let mentionCalls = 0
  let postCalls = 0
  const pushBodies: string[] = []
  fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('push.example')) {
      if (typeof init?.body === 'string') pushBodies.push(init.body)
      return new Response('ok', { status: 201 })
    }
    if (url.startsWith('https://api.tumblr.com/v2/')) {
      const path = url.replace('https://api.tumblr.com/v2', '')
      if (path.includes('/notifications')) {
        mentionCalls++
        const mentions = Array.from({ length: mentionsPerBlog }, (_, i) => ({ id: i + 1, type: 'mention', from_tumblelog_name: 'anon', timestamp: Math.floor(Date.now() / 1000) }))
        return new Response(JSON.stringify({ response: { notifications: mentions } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (path.includes('/notes')) {
        notesCalls++
        const idParam = new URL(url).searchParams.get('id') || ''
        const notes = (notesByRoot[idParam] || []).map((n: any) => ({ type: 'reblog', blog_name: n.blog, post_id: n.id, reblog_parent_blog_name: n.parentBlog, timestamp: Math.floor(Date.now() / 1000) }))
        return new Response(JSON.stringify({ response: { notes } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (path.includes('/posts/')) {
        postCalls++
        const postId = decodeURIComponent(path.split('/posts/')[1])
        const preview = postId in postPreviews ? postPreviews[postId] : null
        const raw: any = post(postId, 'partner', 'root', 'main')
        raw.blog = { name: 'partner' }
        raw.id_string = postId
        if (preview) raw.content = [{ text: preview }]
        return new Response(JSON.stringify({ response: raw }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (path.includes('/info')) {
        return new Response(JSON.stringify({ response: { user: { blogs: [{ name: 'main' }] } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  })
  return { notesCalls: () => notesCalls, mentionCalls: () => mentionCalls, postCalls: () => postCalls, pushBodies }
}

describe('tracking refresh runner', () => {
  it('sends exactly one summary push per workspace when many mentions arrive, and stays under 50 subrequests', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w1'
    await seedBase(db, ws, 'conn1', 'main.tumblr.com', 'c1')
    for (let i = 1; i <= 5; i++) {
      addStarter(db, ws, 'c1', 's' + i, 'root' + i, 'main.tumblr.com')
      addPartner(db, ws, 'p' + i, 'partner' + i + '.tumblr.com')
      addBranch(db, ws, 's' + i, 'p' + i, 'partner' + i + '.tumblr.com')
    }
    await db.prepare('INSERT INTO push_subscriptions (id, workspace_id, user_id, endpoint) VALUES (?,?,?,?)').bind('sub1', ws, 'u-' + ws, 'https://push.example/1').run()
    await db.prepare('INSERT INTO push_subscriptions (id, workspace_id, user_id, endpoint) VALUES (?,?,?,?)').bind('sub2', ws, 'u-' + ws, 'https://push.example/2').run()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mock = mockTumblr(fetchSpy, { mentionsPerBlog: 5, notesByRoot: { root1: [{ id: 'np1', blog: 'partner1', parentBlog: 'main' }] } })
    const result = await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100)
    expect(result.refreshed).toBeGreaterThanOrEqual(1)
    expect(mock.pushBodies.length).toBe(2)
    const delivered = JSON.parse(mock.pushBodies[0])
    expect(delivered.body).toContain('replies waiting')
    expect(delivered.body).toContain('new tags')
    const dueFetches = 2 + 2
    const dueD1 = 1 + 2
    const total = result.fetchesUsed! + dueFetches + dueD1
    expect(total).toBeLessThanOrEqual(50)
    console.log('TEST: worst-case total subrequests =', total, '(fetchesUsed=' + result.fetchesUsed + ')')
    fetchSpy.mockRestore()
    await dispose()
  })

  it('fetches each starter notes once per run across sideblogs, and mentions once per blog', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w2'
    await seedBase(db, ws, 'conn2', 'main.tumblr.com', 'c2')
    for (const blog of ['side1.tumblr.com', 'side2.tumblr.com']) {
      await db.prepare('INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES (?,?,?,?,?,?)').bind('cb-c2-' + blog, ws, 'c2', 'conn2', blog, blog).run()
    }
    for (let i = 1; i <= 6; i++) {
      addStarter(db, ws, 'c2', 's' + i, 'root' + i, 'main.tumblr.com')
      addPartner(db, ws, 'p' + i, 'partner' + i + '.tumblr.com')
      addBranch(db, ws, 's' + i, 'p' + i, 'partner' + i + '.tumblr.com')
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mock = mockTumblr(fetchSpy, {})
    await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100)
    expect(mock.notesCalls()).toBe(6)
    expect(mock.mentionCalls()).toBe(3)
    fetchSpy.mockRestore()
    await dispose()
  })

  it('refreshes both workspaces across runs with neither starving the other', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    for (const [ws, conn, blog, char] of [['wa', 'connA', 'blogA.tumblr.com', 'ca'], ['wb', 'connB', 'blogB.tumblr.com', 'cb']] as const) {
      await seedBase(db, ws, conn, blog, char)
      addStarter(db, ws, char, 's-' + ws, 'root-' + ws, blog)
      addPartner(db, ws, 'pp-' + ws, 'partner-' + ws + '.tumblr.com')
      addBranch(db, ws, 's-' + ws, 'pp-' + ws, 'partner-' + ws + '.tumblr.com')
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockTumblr(fetchSpy, {})
    const first = await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 1)
    const second = await runRefreshBatch(env, new Date('2026-11-15T12:30:00Z'), 1)
    expect(first.selected).toBe(1)
    expect(second.selected).toBe(1)
    expect(first.refreshed + second.refreshed).toBe(2)
    fetchSpy.mockRestore()
    await dispose()
  })

  it('fairness: a workspace with 50 due blogs cannot starve two 1-blog workspaces (budget 5, first run)', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    // big workspace: 50 due blogs on one connection; small1/small2: 1 each.
    await seedBase(db, 'wb', 'connB', 'blogB.tumblr.com', 'cb')
    for (let i = 1; i < 50; i++) {
      await db.prepare("INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES (?,?,?,?,?,?)")
        .bind('cb-b' + i, 'wb', 'cb', 'connB', 'blogB-' + i + '.tumblr.com', 'blogB-' + i + '.tumblr.com').run()
    }
    await seedBase(db, 'ws1', 'connS1', 'blogS1.tumblr.com', 'cs1')
    await seedBase(db, 'ws2', 'connS2', 'blogS2.tumblr.com', 'cs2')
    for (const [ws, char, blog] of [['wb', 'cb', 'blogB.tumblr.com'], ['ws1', 'cs1', 'blogS1.tumblr.com'], ['ws2', 'cs2', 'blogS2.tumblr.com']] as const) {
      addStarter(db, ws, char, 's-' + ws, 'root-' + ws, blog)
      addPartner(db, ws, 'pp-' + ws, 'partner-' + ws + '.tumblr.com')
      addBranch(db, ws, 's-' + ws, 'pp-' + ws, 'partner-' + ws + '.tumblr.com')
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockTumblr(fetchSpy, {})
    const run = await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 5)
    // Round-robin: both 1-blog workspaces land in the first round, so their
    // single branch is stamped even though the big workspace has 50 due blogs.
    const stamped = async (ws: string) => (await db.prepare('SELECT last_refresh_at FROM reply_branches WHERE workspace_id=?').bind(ws).first())?.last_refresh_at as string | null
    expect(await stamped('ws1')).toBeTruthy()
    expect(await stamped('ws2')).toBeTruthy()
    expect(await stamped('wb')).toBeTruthy()
    expect(run.refreshed).toBeGreaterThanOrEqual(3)
    fetchSpy.mockRestore()
    await dispose()
  })

  it('uses only the characters own blogs for their_turn on a shared blog', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w4'
    await seedBase(db, ws, 'conn4', 'shared.tumblr.com', 'c1')
    await db.prepare('INSERT INTO characters (id, workspace_id, name) VALUES (?,?,?)').bind('c2', ws, 'C2').run()
    const cipher2 = await encryptToken('tok2', ENC_KEY)
    await db.prepare('INSERT INTO tumblr_connections (id, workspace_id, token_encrypted, token_secret_encrypted, account_metadata_json) VALUES (?,?,?,?,?)').bind('conn4b', ws, cipher2, cipher2, JSON.stringify({ blogs: ['shared.tumblr.com'] })).run()
    await db.prepare('INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES (?,?,?,?,?,?)').bind('cb-c2', ws, 'c2', 'conn4b', 'shared.tumblr.com', 'shared.tumblr.com').run()
    addStarter(db, ws, 'c1', 's1', 'root1', 'shared.tumblr.com')
    addStarter(db, ws, 'c2', 's2', 'root2', 'shared.tumblr.com')
    addPartner(db, ws, 'p1', 'shared.tumblr.com')
    addBranch(db, ws, 's1', 'p1', 'shared.tumblr.com')
    addBranch(db, ws, 's2', 'p1', 'shared.tumblr.com')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockTumblr(fetchSpy, { notesByRoot: { root1: [{ id: 'np1', blog: 'shared', parentBlog: 'shared' }], root2: [{ id: 'np2', blog: 'shared', parentBlog: 'shared' }] } })
    await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100)
    const s1 = (await db.prepare('SELECT status FROM reply_branches WHERE starter_id = ?').bind('s1').first()) as any
    const s2 = (await db.prepare('SELECT status FROM reply_branches WHERE starter_id = ?').bind('s2').first()) as any
    expect(s1?.status).toBe('your_turn')
    expect(s2?.status).toBe('your_turn')
    fetchSpy.mockRestore()
    await dispose()
  })

  it('stops mid-way on budget: next run resumes at skipped starters, no refresh_error on postponed branches', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w5'
    await seedBase(db, ws, 'conn5', 'main.tumblr.com', 'c5')
    for (let i = 1; i <= 6; i++) {
      addStarter(db, ws, 'c5', 's' + i, 'root' + i, 'main.tumblr.com')
      addPartner(db, ws, 'p' + i, 'partner' + i + '.tumblr.com')
      addBranch(db, ws, 's' + i, 'p' + i, 'partner' + i + '.tumblr.com')
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mock = mockTumblr(fetchSpy, {})
    const first = await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100, { fetchBudget: 8 })
    const firstNotes = mock.notesCalls()
    expect(firstNotes).toBeGreaterThan(0)
    expect(firstNotes).toBeLessThan(6)
    expect(first.failed).toBe(0)
    const err1 = (await db.prepare('SELECT COUNT(*) AS count FROM reply_branches WHERE refresh_error IS NOT NULL').first()) as any
    expect(err1?.count).toBe(0)
    const second = await runRefreshBatch(env, new Date('2026-11-15T12:30:00Z'), 100, { fetchBudget: 8 })
    const totalNotes = mock.notesCalls()
    expect(totalNotes).toBe(6)
    const err2 = (await db.prepare('SELECT COUNT(*) AS count FROM reply_branches WHERE refresh_error IS NOT NULL').first()) as any
    expect(err2?.count).toBe(0)
    fetchSpy.mockRestore()
    await dispose()
  })

  it('stores the latest reply text per branch, keeping a sideblog branch separate', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w6'
    await seedBase(db, ws, 'conn6', 'main.tumblr.com', 'c6')
    await db.prepare('INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES (?,?,?,?,?,?)').bind('cb-c6-side', ws, 'c6', 'conn6', 'side.tumblr.com', 'side.tumblr.com').run()
    // Starter 1: main-blog reply. Starter 2: sideblog reply — must keep its own excerpt.
    addStarter(db, ws, 'c6', 's1', 'root1', 'main.tumblr.com')
    addStarter(db, ws, 'c6', 's2', 'root2', 'side.tumblr.com')
    addPartner(db, ws, 'p1', 'main.tumblr.com')
    addPartner(db, ws, 'p2', 'side.tumblr.com')
    addBranch(db, ws, 's1', 'p1', 'main.tumblr.com')
    addBranch(db, ws, 's2', 'p2', 'side.tumblr.com')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mock = mockTumblr(fetchSpy, {
      notesByRoot: { root1: [{ id: 'reply-main', blog: 'main', parentBlog: 'main' }], root2: [{ id: 'reply-side', blog: 'side', parentBlog: 'side' }] },
      postPreviews: { 'reply-main': 'Main blog reply body.', 'reply-side': 'Sideblog reply body.' },
    })
    await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100)
    const s1 = (await db.prepare('SELECT latest_reply_excerpt FROM reply_branches WHERE starter_id = ?').bind('s1').first()) as any
    const s2 = (await db.prepare('SELECT latest_reply_excerpt, latest_post_id FROM reply_branches WHERE starter_id = ?').bind('s2').first()) as any
    expect(s1?.latest_reply_excerpt).toBe('Main blog reply body.')
    expect(s2?.latest_reply_excerpt).toBe('Sideblog reply body.')
    expect(s2?.latest_post_id).toBe('reply-side')
    // Each distinct reply fetched once; the two branches never share an excerpt.
    expect(mock.postCalls()).toBe(2)
    fetchSpy.mockRestore()
    await dispose()
  })

  it('trims a long reply to 500 chars on a word boundary', async () => {
    const { env, dispose } = await makeEnv()
    const db = env.DB
    const ws = 'w7'
    await seedBase(db, ws, 'conn7', 'main.tumblr.com', 'c7')
    addStarter(db, ws, 'c7', 's1', 'root1', 'main.tumblr.com')
    addPartner(db, ws, 'p1', 'main.tumblr.com')
    addBranch(db, ws, 's1', 'p1', 'main.tumblr.com')
    const longReply = 'word '.repeat(120).trim() // 600 chars, spaces every 5
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mock = mockTumblr(fetchSpy, { notesByRoot: { root1: [{ id: 'r1', blog: 'main', parentBlog: 'main' }] }, postPreviews: { r1: longReply } })
    await runRefreshBatch(env, new Date('2026-11-15T12:00:00Z'), 100)
    const row = (await db.prepare('SELECT latest_reply_excerpt FROM reply_branches WHERE starter_id = ?').bind('s1').first()) as any
    const excerpt = row?.latest_reply_excerpt as string
    expect(excerpt.length).toBeLessThanOrEqual(500)
    expect(excerpt).not.toMatch(/\s$/)
    expect(longReply.startsWith(excerpt)).toBe(true)
    fetchSpy.mockRestore()
    await dispose()
  })
})
