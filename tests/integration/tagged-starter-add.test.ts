// B08: a tagged starter added from the Activity page. No character blog must
// surface an actionable 409 (code character_needs_blog) instead of a plain
// 400; with a blog the add succeeds; re-adding the same tagged post returns
// the same starter and never a duplicate row.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

it('a character without a Tumblr blog gets 409 + character_needs_blog', async () => {
  // The fixture gives both seeded characters a blog; add a bare one with none.
  await fixture.env.DB
    .prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)')
    .bind('character-noblog', 'a', 'No blog character')
    .run()

  const res = await fixture.request('/api/starters', 'POST', { ...starterInput, characterId: 'character-noblog' })
  expect(res.status).toBe(409)
  const body = await res.json() as { error: string; code: string }
  expect(body.code).toBe('character_needs_blog')
  expect(body.error).toMatch(/Assign a Tumblr blog/i)

  // Nothing was created.
  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=?')
    .bind('a')
    .first<{ n: number }>()
  expect(count?.n).toBe(0)
})

it('a character with a blog can add the tagged post', async () => {
  const res = await fixture.request('/api/starters', 'POST', starterInput)
  expect(res.status).toBe(201)
  const created = await res.json() as { id: string; threadRootBlogId: string; threadRootId: string }
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('12345')
})

it('re-adding the same tagged post returns the same starter, no duplicate', async () => {
  const first = await fixture.request('/api/starters', 'POST', starterInput)
  expect(first.status).toBe(201)
  const created = await first.json() as { id: string }

  // Second add of the identical tagged post (a retry) must not duplicate.
  const again = await fixture.request('/api/starters', 'POST', starterInput)
  expect(again.status).toBe(201)
  const reimported = await again.json() as { id: string }
  expect(reimported.id).toBe(created.id)

  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=? AND thread_root_blog_id=? AND thread_root_id=?')
    .bind('a', 'a.tumblr.com', '12345')
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
})
