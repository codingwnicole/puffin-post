import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'
import { encryptToken } from '../../src/tumblr/oauth'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
let urls: string[]
beforeEach(async () => {
  fixture = await trackingFixture()
  const db = fixture.env.DB
  // Workspace a: main blog a (Character a) + sideblog a-side for a second muse on the same connection.
  await db.batch([
    db.prepare("UPDATE tumblr_connections SET account_metadata_json=? WHERE id='connection-a'").bind(JSON.stringify({ blogs: ['a.tumblr.com', 'a-side.tumblr.com'] })),
    db.prepare("INSERT INTO characters (id,workspace_id,name) VALUES ('character-a2','a','Second Muse')"),
    db.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-a2','a','character-a2','connection-a','a-side.tumblr.com','side')"),
  ])
  urls = []
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { urls.push(String(input)); return inner(input, init) }) as typeof fetch
}, 30_000)
afterEach(async () => { await fixture?.dispose() })

const note = (blog: string, parent: string, id: string, t: number) => ({ type: 'reblog', blog_name: blog, post_id: id, reblog_parent_blog_name: parent, timestamp: t })

it('the user’s own sideblog in a thread is choosable but never auto-picked as the writing partner', async () => {
  ;(globalThis as any).__tumblrStubNotes = { notes: [note('a-side', 'a', '2', 20), note('friend', 'a', '3', 30)] }
  const both = await (await fixture.request('/api/starters/resolve', 'POST', { postUrl: 'https://a.tumblr.com/post/1', characterId: 'character-a' })).json() as { participants: string[]; suggestedPartner: string | null }
  expect(both.participants).toEqual(['a-side.tumblr.com', 'friend.tumblr.com'])
  expect(both.suggestedPartner).toBe('friend.tumblr.com')
  ;(globalThis as any).__tumblrStubNotes = { notes: [note('a-side', 'a', '2', 20)] }
  const ownOnly = await (await fixture.request('/api/starters/resolve', 'POST', { postUrl: 'https://a.tumblr.com/post/1', characterId: 'character-a' })).json() as { participants: string[]; suggestedPartner: string | null }
  expect(ownOnly.participants).toEqual(['a-side.tumblr.com'])
  expect(ownOnly.suggestedPartner).toBeNull()
  // Adding without choosing is refused; choosing the own sideblog explicitly works (two own muses RP together).
  expect((await fixture.request('/api/starters', 'POST', { characterId: 'character-a', postUrl: 'https://a.tumblr.com/post/1' })).status).toBe(400)
  expect((await fixture.request('/api/starters', 'POST', { characterId: 'character-a', postUrl: 'https://a.tumblr.com/post/1', partnerBlogIdentifier: 'a-side.tumblr.com' })).status).toBe(201)
  ;(globalThis as any).__tumblrStubNotes = undefined
})

it('thread notes are read as reblogs only, so likes can never hide the latest reply', async () => {
  await fixture.request('/api/starters/resolve', 'POST', { postUrl: 'https://a.tumblr.com/post/1', characterId: 'character-a' })
  const notes = urls.filter(url => url.includes('/notes?'))
  expect(notes.length).toBeGreaterThan(0)
  for (const url of notes) expect(url).toContain('mode=reblogs_with_tags')
})

it('a post on a second Tumblr account’s blog is read with that account’s token', async () => {
  const db = fixture.env.DB
  const cipher = await encryptToken('token-second', fixture.env.TOKEN_ENCRYPTION_KEY)
  await db.prepare("INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES ('connection-a3','a',?,?,?)").bind(cipher, cipher, JSON.stringify({ blogs: ['locked.tumblr.com'] })).run()
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
    // A password-protected sideblog: only its own account can read it.
    if (String(input).includes('locked.tumblr.com') && !auth.includes('token-second')) return new Response('{}', { status: 404 })
    return inner(input, init)
  }) as typeof fetch
  const response = await fixture.request('/api/starters/resolve', 'POST', { postUrl: 'https://www.tumblr.com/locked/77', characterId: 'character-a' })
  expect(response.status).toBe(200)
})

it('a new sideblog becomes assignable and a renamed blog keeps its threads, without reconnecting', async () => {
  const db = fixture.env.DB
  // Known list: a (uuid t:A) and a-side (uuid t:S), read long ago. Tumblr now says t:S is called
  // muse-renamed, and a brand-new sideblog fresh-side exists.
  await db.prepare("UPDATE tumblr_connections SET account_metadata_json=? WHERE id='connection-a'").bind(JSON.stringify({ blogs: ['a.tumblr.com', 'a-side.tumblr.com'], uuids: { 't:A': 'a.tumblr.com', 't:S': 'a-side.tumblr.com' }, refreshedAt: '2026-01-01T00:00:00.000Z' })).run()
  await db.prepare("INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id) VALUES ('s-side','a','character-a2','Side scene','tumblr','5','a-side.tumblr.com')").run()
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/user/info')
    ? new Response(JSON.stringify({ response: { user: { blogs: [{ name: 'a', uuid: 't:A' }, { name: 'muse-renamed', uuid: 't:S' }, { name: 'fresh-side', uuid: 't:F' }] } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : inner(input, init)) as typeof fetch
  const [connection] = await (await fixture.request('/api/connections')).json() as Array<{ blogs: string[]; assignments: Array<{ characterId: string; blogIdentifier: string }> }>
  expect(connection.blogs).toEqual(['a.tumblr.com', 'muse-renamed.tumblr.com', 'fresh-side.tumblr.com'])
  expect(connection.assignments.find(row => row.characterId === 'character-a2')?.blogIdentifier).toBe('muse-renamed.tumblr.com')
  expect((await db.prepare("SELECT root_blog_id AS r FROM starters WHERE id='s-side'").first<{ r: string }>())?.r).toBe('muse-renamed.tumblr.com')
  // Workspace b is untouched by a's rename.
  expect((await db.prepare("SELECT blog_identifier AS b FROM character_blogs WHERE workspace_id='b'").first<{ b: string }>())?.b).toBe('b.tumblr.com')
  expect((await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'fresh-side.tumblr.com' })).status).toBe(201)
})
