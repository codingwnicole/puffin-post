// B10 regression: importing the same thread through different paths (activity
// URL, reblog URL, concurrent) must produce exactly ONE starter — the
// find-or-create + unique (workspace, thread_root_blog_id, thread_root_id)
// index + repair script already handle this; this pins the behavior.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

// The fixture's stubbed Tumblr returns rootPostId === id and
// rootBlogIdentifier === blogIdentifier, so every post URL resolves to its own
// (blog, post) root. Adding the same post again — directly or "via reblog"
// (a reblog URL that still points at the same root) — hits the same unique
// (workspace, thread_root_blog_id, thread_root_id) key.
it('imports the same scene via URL, reblog URL, and concurrency as exactly one starter', async () => {
  // 1. First import via the activity URL.
  const first = await fixture.request('/api/starters', 'POST', starterInput)
  expect(first.status).toBe(201)
  const created = await first.json() as { id: string; threadRootBlogId: string; threadRootId: string }
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('12345')

  // 2. Re-import the same scene "via reblog" (same root, different surface).
  const viaReblog = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl: 'https://a.tumblr.com/post/12345/reblog' })
  expect(viaReblog.status).toBe(201)

  // 3. Concurrency: a parallel import of the same scene resolves to the same
  //    starter rather than creating a second one.
  const [a, b] = await Promise.all([
    fixture.request('/api/starters', 'POST', starterInput),
    fixture.request('/api/starters', 'POST', starterInput),
  ])
  expect(a.status).toBe(201)
  expect(b.status).toBe(201)
  const same = await a.json() as { id: string }
  const other = await b.json() as { id: string }

  // All import paths converge on a single starter id.
  expect(same.id).toBe(created.id)
  expect(other.id).toBe(created.id)

  // And exactly one row exists for that thread root — no duplicates.
  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=? AND thread_root_blog_id=? AND thread_root_id=?')
    .bind('a', 'a.tumblr.com', '12345')
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
})

it('re-importing a tracked scene is idempotent: same starter, no duplicate rows', async () => {
  const first = await fixture.request('/api/starters', 'POST', starterInput)
  expect(first.status).toBe(201)
  const created = await first.json() as { id: string }

  // Re-import the identical scene (as a repeat activity/URL add would). It must
  // return the existing starter, not create a second one.
  const again = await fixture.request('/api/starters', 'POST', starterInput)
  expect(again.status).toBe(201)
  const reimported = await again.json() as { id: string }
  expect(reimported.id).toBe(created.id)

  // Still exactly one starter row for the thread root.
  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=? AND thread_root_blog_id=? AND thread_root_id=?')
    .bind('a', 'a.tumblr.com', '12345')
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
})
