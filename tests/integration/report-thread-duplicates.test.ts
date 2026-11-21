import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

const sql = readFileSync('scripts/report-thread-duplicates.sql', 'utf8')
const starter = (id: string, ws: string, rootPost: string, threadRoot: string | null, createdAt: string, rootBlog = 'a.tumblr.com') =>
  fixture.env.DB.prepare("INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id,thread_root_id,thread_root_blog_id,created_at) VALUES (?,?,?,'T','tumblr',?,?,?,?,?)")
    .bind(id, ws, `character-${ws}`, rootPost, rootBlog, threadRoot, threadRoot ? 'partner.tumblr.com' : null, createdAt)

it('lists draft-converted and reply-matched duplicates once each, and nothing else', async () => {
  const db = fixture.env.DB
  await db.batch([
    starter('tracked', 'a', '12345', '999', '2026-01-01T00:00:00Z'),
    db.prepare("INSERT INTO reply_branches (id,workspace_id,starter_id,status,latest_post_id) VALUES ('tracked-b','a','tracked','your_turn','888')"),
    // Converted from a draft: same post, but no thread root recorded.
    starter('from-draft', 'a', '12345', null, '2026-02-01T00:00:00Z'),
    // Tracked from the partner's latest reply in the same thread.
    starter('from-reply', 'a', '888', null, '2026-03-01T00:00:00Z'),
    starter('unrelated', 'a', '4242', '4242', '2026-01-05T00:00:00Z'),
    starter('manual-1', 'a', 'same-uuid', 'same-uuid', '2026-01-01T00:00:00Z', 'manual'),
    starter('manual-2', 'a', 'same-uuid', null, '2026-02-01T00:00:00Z', 'manual'),
    // Another workspace tracking the same thread is not a duplicate.
    starter('other-ws', 'b', '12345', '999', '2026-04-01T00:00:00Z'),
  ])
  const rows = (await db.prepare(sql).all<{ keep_id: string; duplicate_id: string; duplicate_branches: number }>()).results
  expect(rows.map(row => [row.keep_id, row.duplicate_id])).toEqual([['tracked', 'from-draft'], ['tracked', 'from-reply']])
  expect(rows.every(row => row.duplicate_branches === 0)).toBe(true)
  expect(Object.keys(rows[0])).not.toContain('title')
})
