// Item 39: firing the SAME create twice concurrently must be safe. The starters
// repo's find-or-create + unique (workspace, thread_root_blog_id, thread_root_id)
// index, and the character_blogs unique indexes, must converge — these tests pin
// the contract and force a route fix (catch the UNIQUE constraint -> return the
// existing row) if a 500 leaks through under a true race.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

// A fresh connection with a blog nobody has claimed yet: the only way to reach a
// real concurrent character_blogs INSERT (the fixture's own blogs are already
// claimed whole, which 400s before any insert). Same (character, blog) fired
// twice -> both pass the existing-check, both INSERT, the (workspace, character,
// blog) unique index must converge to one row.
it('the same blog assignment fired twice concurrently yields one character_blogs row, no 500', async () => {
  await fixture.env.DB.prepare(
    'INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)'
  ).bind('connection-fresh', 'a', 't', 't', JSON.stringify({ blogs: ['z.tumblr.com'] })).run()

  const [a, b] = await Promise.all([
    fixture.request('/api/connections/connection-fresh/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'z.tumblr.com', displayLabel: 'Z side' }),
    fixture.request('/api/connections/connection-fresh/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'z.tumblr.com', displayLabel: 'Z side' }),
  ])
  for (const response of [a, b]) {
    expect([200, 201, 409], `unexpected status ${response.status}: ${await response.clone().text()}`).toContain(response.status)
  }
  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?')
    .bind('a', 'character-a', 'z.tumblr.com')
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
})

it('two concurrent create-starter requests for the same thread yield exactly one starter, no 500', async () => {
  const [a, b] = await Promise.all([
    fixture.request('/api/starters', 'POST', starterInput),
    fixture.request('/api/starters', 'POST', starterInput),
  ])
  // Both must succeed: 2xx on both, or one 2xx + one 409 carrying the existing id — never a 500.
  for (const response of [a, b]) {
    expect([200, 201, 409], `unexpected status ${response.status}: ${await response.clone().text()}`).toContain(response.status)
  }
  const count = await fixture.env.DB
    .prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=? AND thread_root_blog_id=? AND thread_root_id=?')
    .bind('a', 'a.tumblr.com', '12345')
    .first<{ n: number }>()
  expect(count?.n).toBe(1)
})

it('two concurrent saves for one character+blog with different tags end in one row carrying one of the tags', async () => {
  await fixture.env.DB.prepare(
    'INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)'
  ).bind('connection-fresh', 'a', 't', 't', JSON.stringify({ blogs: ['z.tumblr.com'] })).run()
  const save = (characterTag: string) => fixture.request('/api/connections/connection-fresh/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'z.tumblr.com', characterTag })
  const responses = await Promise.all([save('tag one'), save('tag two')])
  for (const response of responses) expect([200, 201]).toContain(response.status)
  const rows = await fixture.env.DB.prepare("SELECT character_tag AS tag FROM character_blogs WHERE workspace_id='a' AND character_id='character-a' AND blog_identifier='z.tumblr.com'").all<{ tag: string }>()
  expect(rows.results).toHaveLength(1)
  expect(['tag one', 'tag two']).toContain(rows.results[0].tag)
})
