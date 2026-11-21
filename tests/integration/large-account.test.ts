import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'
import { encryptToken } from '../../src/tumblr/oauth'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 60_000)
afterEach(async () => { await fixture?.dispose() })

// The local D1 proxy can reset one very large batch, so seed in chunks of 500 statements.
async function batchInChunks(db: D1Database, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 500) await db.batch(statements.slice(i, i + 500))
}

async function seedLargeAccount() {
  const { env } = fixture
  // Fixture already seeded a.tumblr.com (character-a) and b.tumblr.com (character-b)
  // in workspace 'a'. Add c, d, e.tumblr.com on a second connection.
  const cipher = await encryptToken('tok-cde', env.TOKEN_ENCRYPTION_KEY)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('conn-big', 'a', cipher, cipher, JSON.stringify({ blogs: ['c.tumblr.com', 'd.tumblr.com', 'e.tumblr.com'] })),
    ...['c', 'd', 'e'].map((b, i) =>
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)').bind('blog-big-' + i, 'a', 'character-a', 'conn-big', b + '.tumblr.com', b)
    ),
  ])

  const blogs = ['a.tumblr.com', 'b.tumblr.com', 'c.tumblr.com', 'd.tumblr.com', 'e.tumblr.com']
  const starterBatch = []
  for (let i = 0; i < 2000; i++) {
    const id = 'starter-big-' + i
    starterBatch.push(env.DB.prepare('INSERT INTO starters (id,workspace_id,character_id,title,root_post_id,root_blog_id,description,thread_root_id,thread_root_blog_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, 'a', 'character-a', 'Scene ' + i, String(100000 + i), blogs[i % 5], '', String(100000 + i), blogs[i % 5]))
    starterBatch.push(env.DB.prepare('INSERT INTO reply_branches (id,workspace_id,starter_id,status,notes,last_activity_at) VALUES (?,?,?,? ,?,?)').bind('branch-big-' + i, 'a', id, 'your_turn', 'note ' + i, '2026-01-' + String((i % 28) + 1) + 'T0' + (i % 10) + ':00:00.000Z'))
  }
  await batchInChunks(env.DB, starterBatch)

  const actBatch = []
  for (let i = 0; i < 3000; i++) {
    actBatch.push(env.DB.prepare('INSERT INTO activities (id,workspace_id,starter_id,reply_branch_id,type,actor,source,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('act-' + i, 'a', 'starter-big-' + (i % 2000), 'branch-big-' + (i % 2000), 'note', blogs[i % 5], 'tumblr', '2026-01-' + String((i % 28) + 1) + 'T' + String(i % 24).padStart(2, '0') + ':00:00.000Z'))
  }
  await batchInChunks(env.DB, actBatch)
}

it('answers main list routes with bounded pages on a 2000-starter account', async () => {
  await seedLargeAccount()

  const t0 = performance.now()
  const inbox = await fixture.request('/api/inbox?limit=100')
  const t1 = performance.now()
  const inboxBody = (await inbox.json()) as any
  expect(inboxBody.branches.length).toBeLessThanOrEqual(100)
  expect(inboxBody.hasMore).toBe(true)
  console.log('inbox first page: ' + (t1 - t0).toFixed(1) + 'ms, ' + inboxBody.branches.length + ' rows')

  const t2 = performance.now()
  const page2 = await fixture.request('/api/inbox?limit=100&offset=500')
  const t3 = performance.now()
  const page2Body = (await page2.json()) as any
  expect(page2Body.branches.length).toBe(100)
  console.log('inbox offset=500: ' + (t3 - t2).toFixed(1) + 'ms')

  const t4 = performance.now()
  const planner = await fixture.request('/api/character-planner?limit=100')
  const t5 = performance.now()
  const plannerBody = (await planner.json()) as any
  expect(plannerBody.plans.length).toBeLessThanOrEqual(100)
  console.log('planner first page: ' + (t5 - t4).toFixed(1) + 'ms, ' + plannerBody.plans.length + ' rows')

  const t6 = performance.now()
  const options = await fixture.request('/api/starters/options')
  const t7 = performance.now()
  expect(options.status).toBe(200)
  console.log('starters/options: ' + (t7 - t6).toFixed(1) + 'ms')

  expect(t1 - t0).toBeLessThan(5000)
  expect(t3 - t2).toBeLessThan(5000)
  expect(t5 - t4).toBeLessThan(5000)
}, 60_000)

it('character thread counts cover every active thread, not just the first inbox page', async () => {
  const db = fixture.env.DB
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < 230; i++) {
    const archived = i >= 220
    stmts.push(db.prepare("INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id) VALUES (?,'a','character-a','T','tumblr',?,'a.tumblr.com')").bind(`cnt-${i}`, `cnt-root-${i}`))
    stmts.push(db.prepare("INSERT INTO reply_branches (id,workspace_id,starter_id,status,archived_at) VALUES (?,'a',?,?,?)").bind(`cnt-b-${i}`, `cnt-${i}`, archived ? 'archived' : i % 2 ? 'their_turn' : 'your_turn', archived ? '2026-01-01T00:00:00Z' : null))
  }
  await batchInChunks(db, stmts)
  const characters = await (await fixture.request('/api/characters')).json() as Array<{ id: string; threadCounts: { total: number; mine: number; theirs: number } }>
  const active = await db.prepare("SELECT COUNT(*) AS n FROM reply_branches b JOIN starters s ON s.id=b.starter_id WHERE s.character_id='character-a' AND b.archived_at IS NULL AND s.archived=0").first<{ n: number }>()
  const counts = characters.find(row => row.id === 'character-a')!.threadCounts
  expect(counts.total).toBe(active!.n)
  expect(counts.total).toBeGreaterThan(200)
  expect(counts.mine).toBeGreaterThanOrEqual(110)
  expect(counts.theirs).toBeGreaterThanOrEqual(110)
}, 60_000)
