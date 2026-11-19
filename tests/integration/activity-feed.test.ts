import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

// The fixture seeds one blog per workspace; the activity route is workspace-scoped,
// so add a second blog (c.tumblr.com) to workspace a to exercise the multi-blog feed.
async function seedSecondBlog() {
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const cipher = await encryptToken('token-c', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-c', 'a', cipher, cipher, JSON.stringify({ blogs: ['c.tumblr.com'] })).run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-c','a','character-a','connection-c','c.tumblr.com','c')").run()
}

function notificationsResponse(blog: string, items: Array<{ type: string; timestamp: number; post_id?: string | number; from_tumblelog_name?: string }>) {
  const notifications = items.map(item => ({ ...item, blog_name: blog, id: `${blog}:${item.post_id ?? item.timestamp}` }))
  return new Response(JSON.stringify({ response: { notifications, meta: { total: { notifications: notifications.length, asks: notifications.filter(item => item.type === 'ask').length, mentions: notifications.filter(item => item.type === 'mention').length } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function fetchActivity(path: string, stub: (input: RequestInfo | URL) => Response) {
  const original = globalThis.fetch
  globalThis.fetch = stub as unknown as typeof fetch
  try { return (await fixture.request(path)).json() as unknown as { asks: Array<{ blogIdentifier: string; type: string }>; mentions: Array<{ blogIdentifier: string; type: string }>; threadCandidates: Array<{ id: string; blogIdentifier: string }>; blogs: Array<{ blogIdentifier: string; status: string; error: string | null; exhausted: boolean }>; diagnostics: string[] } }
  finally { globalThis.fetch = original }
}

function blogOf(url: string) { return decodeURIComponent(url.match(/\/blog\/([^/]+)\/notifications/)![1]) }

it('combines asks and tagged posts from both connected blogs', async () => {
  await seedSecondBlog()
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    const blog = blogOf(String(url))
    if (blog === 'a.tumblr.com') return notificationsResponse('a.tumblr.com', [
      { type: 'ask', timestamp: 200, from_tumblelog_name: 'asker' },
      { type: 'mention', timestamp: 100, post_id: 1, from_tumblelog_name: 'tagger' },
    ])
    if (blog === 'c.tumblr.com') return notificationsResponse('c.tumblr.com', [{ type: 'ask', timestamp: 300, from_tumblelog_name: 'other-asker' }])
    return new Response('{}', { status: 404 })
  })
  expect(result.asks.map(item => item.blogIdentifier).sort()).toEqual(['a.tumblr.com', 'c.tumblr.com'])
  expect(result.mentions).toHaveLength(1)
  expect(result.mentions[0].blogIdentifier).toBe('a.tumblr.com')
  expect(result.blogs.map(blog => blog.blogIdentifier).sort()).toEqual(['a.tumblr.com', 'c.tumblr.com'])
})

it('returns the healthy blog when one blog fails and marks the failed blog in blogs', async () => {
  await seedSecondBlog()
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    const blog = blogOf(String(url))
    if (blog === 'c.tumblr.com') return notificationsResponse('c.tumblr.com', [{ type: 'ask', timestamp: 300, from_tumblelog_name: 'other-asker' }])
    if (blog === 'a.tumblr.com') return new Response('{}', { status: 503 })
    return new Response('{}', { status: 404 })
  })
  expect(result.asks.map(item => item.blogIdentifier)).toEqual(['c.tumblr.com'])
  const failed = result.blogs.find(blog => blog.blogIdentifier === 'a.tumblr.com')
  expect(failed).toMatchObject({ status: 'error' })
  expect(failed!.error).toContain('a.tumblr.com')
  expect(result.blogs.find(blog => blog.blogIdentifier === 'c.tumblr.com')).toMatchObject({ status: 'ok', error: null })
  expect(result.diagnostics.some(diagnostic => diagnostic.includes('a.tumblr.com'))).toBe(true)
})

it('filters to the requested blog only', async () => {
  await seedSecondBlog()
  const result = await fetchActivity('/api/tumblr-activity?blog=c.tumblr.com', url => {
    if (String(url).includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).includes('/posts?id=')) return new Response(JSON.stringify({ response: { posts: [{ blog_name: 'a', id_string: '1' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return notificationsResponse(blogOf(String(url)), [{ type: 'ask', timestamp: 200, from_tumblelog_name: 'asker' }])
  })
  expect(result.asks.map(item => item.blogIdentifier)).toEqual(['c.tumblr.com'])
  expect(result.blogs).toHaveLength(1)
  expect(result.blogs[0].blogIdentifier).toBe('c.tumblr.com')
})

it('forwards the before cursor to Tumblr', async () => {
  await seedSecondBlog()
  const calls: string[] = []
  let seenBefore: string | null = null
  const result = await fetchActivity('/api/tumblr-activity?before=123', url => {
    const path = String(url)
    calls.push(path)
    if (path.includes('/notifications')) seenBefore = new URL(path).searchParams.get('before')
    if (path.includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (path.includes('/posts?id=')) return new Response(JSON.stringify({ response: { posts: [{ blog_name: 'a', id_string: '1' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return notificationsResponse(blogOf(path), [{ type: 'ask', timestamp: 100, from_tumblelog_name: 'asker' }])
  })
  expect(seenBefore).toBe('123')
  // The page sends back the ISO oldestTimestamp; it must reach Tumblr as unix seconds.
  await fetchActivity('/api/tumblr-activity?before=' + encodeURIComponent(new Date(123_000).toISOString()), url => {
    const path = String(url)
    if (path.includes('/notifications')) seenBefore = new URL(path).searchParams.get('before')
    if (path.includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return notificationsResponse(blogOf(path), [])
  })
  expect(seenBefore).toBe('123')
  expect(calls).toEqual(expect.arrayContaining(['https://api.tumblr.com/v2/blog/a.tumblr.com/posts?limit=20&npf=true&reblog_info=true', 'https://api.tumblr.com/v2/blog/c.tumblr.com/posts?limit=20&npf=true&reblog_info=true']))
  expect(result.blogs).toHaveLength(2)
  expect(result.blogs.every(blog => blog.status === 'ok')).toBe(true)
}, 60_000)

it('fetches a blog shared by two characters only once', async () => {
  // character-b is linked to the same blog via a second connection in workspace a.
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const sharedCipher = await encryptToken('token-shared', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-shared', 'a', sharedCipher, sharedCipher, JSON.stringify({ blogs: ['a.tumblr.com'] })).run()
  await fixture.env.DB.prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)').bind('character-a2', 'a', 'Shared').run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-shared','a','character-a2','connection-shared','a.tumblr.com','shared')").run()
  let notificationCalls = 0
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/notifications')) notificationCalls += 1
    if (String(url).includes('/posts?limit')) return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).includes('/posts?id=')) return new Response(JSON.stringify({ response: { posts: [{ blog_name: 'a', id_string: '1' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return notificationsResponse(blogOf(String(url)), [{ type: 'ask', timestamp: 200, from_tumblelog_name: 'asker' }])
  })
  expect(notificationCalls).toBe(1)
  expect(result.blogs.filter(blog => blog.blogIdentifier === 'a.tumblr.com')).toHaveLength(1)
  expect(result.blogs.map(blog => blog.blogIdentifier).sort()).toEqual(['a.tumblr.com'])
})

it('a dismissed tagged post stays hidden on the next load (B09)', async () => {
  const stub = (url: RequestInfo | URL) => String(url).includes('/posts?limit')
    ? new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : notificationsResponse('a.tumblr.com', [{ type: 'mention', timestamp: 100, post_id: 77, from_tumblelog_name: 'tagger' }])
  const before = await fetchActivity('/api/tumblr-activity', stub)
  expect(before.mentions).toHaveLength(1)
  const mention = before.mentions[0] as unknown as { blogIdentifier: string; postId: string }
  expect((await fixture.request('/api/tumblr-activity/dismissals', 'POST', { blogIdentifier: mention.blogIdentifier, postId: mention.postId })).status).toBeLessThan(300)
  const after = await fetchActivity('/api/tumblr-activity', stub)
  expect(after.mentions).toHaveLength(0)
})

it('deleting a dismissal un-hides the post and is workspace-scoped (B25)', async () => {
  const stub = (url: RequestInfo | URL) => String(url).includes('/posts?limit')
    ? new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : notificationsResponse('a.tumblr.com', [{ type: 'mention', timestamp: 100, post_id: 77, from_tumblelog_name: 'tagger' }])
  const body = { blogIdentifier: 'a.tumblr.com', postId: '77' }
  expect((await fixture.request('/api/tumblr-activity/dismissals', 'POST', body)).status).toBeLessThan(300)
  // A second workspace deleting the same coordinates must NOT touch workspace a's row.
  expect((await fixture.request('/api/tumblr-activity/dismissals', 'DELETE', body, 'b')).status).toBe(204)
  expect((await fetchActivity('/api/tumblr-activity', stub)).mentions).toHaveLength(0)
  // Workspace a deletes its own row: the post reappears on the next GET.
  expect((await fixture.request('/api/tumblr-activity/dismissals', 'DELETE', body)).status).toBe(204)
  expect((await fetchActivity('/api/tumblr-activity', stub)).mentions).toHaveLength(1)
})
