// T1b: thread identity and "did you mean to track these?" suggestions.
// A tracked thread must never reappear as a candidate, and a starter imported
// from a reblog must resolve to the TRUE thread root (reblogged_root_*, else
// trail[0], else the post itself), never to the reblog's own id.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => {
  await fixture?.dispose()
  delete (globalThis as any).__tumblrStubPosts
})

function stubPost(key: string, post: Record<string, unknown>) {
  const g = globalThis as any
  g.__tumblrStubPosts = g.__tumblrStubPosts ?? {}
  g.__tumblrStubPosts[key] = post
}

async function fetchActivity(path: string, stub: (url: string) => Response | Promise<Response>) {
  const original = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => stub(String(input))
  try { return (await fixture.request(path)).json() as unknown as { threadCandidates: Array<{ id: string; blogIdentifier: string; rootPostId: string; rootBlogIdentifier: string }>; blogs: Array<{ blogIdentifier: string; status: string }> } }
  finally { globalThis.fetch = original }
}

// Seed the tracked thread "ilyas x dimas" (root a.tumblr.com/1000) with a
// branch on it, and a sideblog reblog of that root by the user's other blog.
async function seedTrackedThread() {
  const starterId = 'starter-ilyas'
  await fixture.env.DB.prepare('INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id,thread_root_id,thread_root_blog_id,description) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(starterId, 'a', 'character-a', 'ilyas x dimas', 'tumblr', '1000', 'a.tumblr.com', '1000', 'a.tumblr.com', '').run()
  await fixture.env.DB.prepare('INSERT INTO reply_branches (id,workspace_id,starter_id,partner_id,status,latest_post_id,last_poster) VALUES (?,?,?,?,?,?,?)')
    .bind('branch-ilyas', 'a', starterId, 'partner-a', 'your_turn', '2000', 'a.tumblr.com').run()
}

async function sideblogReblogRecentPosts() {
  // The sideblog's recent feed: one reblog of the tracked root, NPF-style
  // (no reblogged_root_*), so the only way to find the root is trail[0].
  return new Response(JSON.stringify({ response: { posts: [{
    blog_name: 'c', id_string: '3000', tags: ['ilyas'],
    trail: [{ blog: { name: 'a' }, post: { id: '1000' }, content: [{ text: 'ilyas' }] }],
    content: [{ text: 'sideblog reblog' }],
  }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

// 1. NPF reblog, no reblogged_root_*, trail present -> resolves to trail[0].
it('an NPF reblog with a trail resolves to the trail root', async () => {
  stubPost('c:3000', { trail: [{ blog: { name: 'a' }, post: { id: '1000' } }] })
  const res = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl: 'https://c.tumblr.com/post/3000', characterId: 'character-a' })
  expect(res.status).toBe(201)
  const created = await res.json() as { threadRootBlogId: string; threadRootId: string }
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('1000')
})

// 2. Legacy response with reblogged_root_* still works.
it('a legacy response with reblogged_root_* resolves to the root', async () => {
  stubPost('c:4000', { reblogged_root_id: 5000, reblogged_root_name: 'a', trail: [{ blog: { name: 'a' }, post: { id: '9999' } }] })
  const res = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl: 'https://c.tumblr.com/post/4000', characterId: 'character-a' })
  expect(res.status).toBe(201)
  const created = await res.json() as { threadRootBlogId: string; threadRootId: string }
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('5000')
})

// 3. Original post, no trail, no root -> its own root.
it('an original post with no trail is its own root', async () => {
  stubPost('a:6000', { reblogged_root_id: null, reblogged_root_name: null, trail: [] })
  const res = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl: 'https://a.tumblr.com/post/6000', characterId: 'character-a' })
  expect(res.status).toBe(201)
  const created = await res.json() as { threadRootBlogId: string; threadRootId: string }
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('6000')
})

// 4. A tracked thread's reblog (sideblog) is NOT suggested in threadCandidates.
it('a tracked thread is never suggested, even via a sideblog reblog', async () => {
  // Add the sideblog c.tumblr.com to character-a (same workspace).
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const cipher = await encryptToken('token-c', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-c', 'a', cipher, cipher, JSON.stringify({ blogs: ['c.tumblr.com'] })).run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-c','a','character-a','connection-c','c.tumblr.com','c')").run()
  await seedTrackedThread()

  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/posts?')) {
      if (String(url).includes('/blog/c.tumblr.com/')) return sideblogReblogRecentPosts()
      return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).includes('/notifications')) return new Response(JSON.stringify({ response: { notifications: [], meta: { total: { notifications: 0, asks: 0, mentions: 0 } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })
  // The sideblog reblog resolves to the tracked root a.tumblr.com/1000 -> hidden.
  expect(result.threadCandidates).toHaveLength(0)
})

// 4b. An UNTRACKED partner-started thread the user reblogged is still suggested,
//     once, keyed by its true root (not hidden just because it is a reblog).
it('an untracked partner-started reblog is suggested once', async () => {
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (url.includes('/posts?')) return new Response(JSON.stringify({ response: { posts: [
      { blog_name: 'a', id_string: '8001', trail: [{ blog: { name: 'partner' }, post: { id: '8000' } }], content: [{ text: 'newer reblog' }] },
      { blog_name: 'a', id_string: '7999', trail: [{ blog: { name: 'partner' }, post: { id: '8000' } }], content: [{ text: 'older reblog' }] },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/notifications')) return new Response(JSON.stringify({ response: { notifications: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })
  expect(result.threadCandidates.map(c => (c as unknown as { threadKey: string }).threadKey)).toEqual(['partner.tumblr.com:8000'])
})

// 5. Creating a starter from a reblog of an already-tracked thread attaches to
//    the existing thread (no second starter) and is idempotent.
it('a starter from a reblog of a tracked thread attaches, never duplicates', async () => {
  await seedTrackedThread()
  // A fresh reblog post whose trail root is the tracked root a.tumblr.com/1000.
  stubPost('c:7000', { trail: [{ blog: { name: 'a' }, post: { id: '1000' } }] })
  const res = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl: 'https://c.tumblr.com/post/7000', characterId: 'character-a' })
  expect(res.status).toBe(201)
  const created = await res.json() as { id: string; threadRootBlogId: string; threadRootId: string }
  expect(created.id).toBe('starter-ilyas')
  expect(created.threadRootBlogId).toBe('a.tumblr.com')
  expect(created.threadRootId).toBe('1000')
  const count = await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM starters WHERE workspace_id=? AND thread_root_blog_id=? AND thread_root_id=?').bind('a', 'a.tumblr.com', '1000').first<{ n: number }>()
  expect(count?.n).toBe(1)
})

// 6. Main blog + 2 sideblogs on ONE connection: a thread tracked on the main
//    blog is recognized when it surfaces via either sideblog (reblog or
//    mention), and is never suggested again or duplicated.
it('main blog + 2 sideblogs on one connection recognize a shared thread', async () => {
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const cipher = await encryptToken('token-conn1', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-conn1', 'a', cipher, cipher, JSON.stringify({ blogs: ['a.tumblr.com', 'side1.tumblr.com', 'side2.tumblr.com'] })).run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-side1','a','character-a','connection-conn1','side1.tumblr.com','side1')").run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-side2','a','character-a','connection-conn1','side2.tumblr.com','side2')").run()
  await seedTrackedThread()

  // Sideblog 1 recent feed: a reblog of the tracked root (NPF, trail only).
  // Sideblog 2 recent feed: a mention on the tracked root (reblogged_root_*).
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/posts?')) {
      if (String(url).includes('/blog/side1.tumblr.com/')) return sideblogReblogRecentPosts()
      if (String(url).includes('/blog/side2.tumblr.com/')) {
        return new Response(JSON.stringify({ response: { posts: [{
          blog_name: 'side2', id_string: '8000', tags: ['ilyas'],
          reblogged_root_id: 1000, reblogged_root_name: 'a',
          trail: [{ blog: { name: 'a' }, post: { id: '1000' } }],
        }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).includes('/notifications')) return new Response(JSON.stringify({ response: { notifications: [], meta: { total: { notifications: 0, asks: 0, mentions: 0 } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })
  expect(result.threadCandidates).toHaveLength(0)
  // Both sideblogs are connected and healthy.
  expect(result.blogs.map(b => b.blogIdentifier).sort()).toEqual(['a.tumblr.com', 'side1.tumblr.com', 'side2.tumblr.com'])
})

// 7. TWO connections (two Tumblr accounts): a thread tracked under account 1's
//    blog is recognized when it surfaces via account 2's blog.
it('two connections: a thread tracked on one account is never suggested on the other', async () => {
  // connection-2 is the fixture's second workspace 'b' blog; but the route is
  // workspace-scoped, so put a second CONNECTION on workspace a pointing at a
  // new account blog d.tumblr.com.
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const cipher = await encryptToken('token-conn2', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-conn2', 'a', cipher, cipher, JSON.stringify({ blogs: ['d.tumblr.com'] })).run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-d','a','character-a','connection-conn2','d.tumblr.com','d')").run()
  await seedTrackedThread()

  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/posts?')) {
      if (String(url).includes('/blog/d.tumblr.com/')) {
        // d.tumblr.com reblogs the tracked root (NPF, trail only).
        return new Response(JSON.stringify({ response: { posts: [{
          blog_name: 'd', id_string: '9000', tags: ['ilyas'],
          trail: [{ blog: { name: 'a' }, post: { id: '1000' } }],
        }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).includes('/notifications')) return new Response(JSON.stringify({ response: { notifications: [], meta: { total: { notifications: 0, asks: 0, mentions: 0 } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })
  expect(result.threadCandidates).toHaveLength(0)
})

// 8. One blog shared by two characters (told apart by character tags): the
//    shared blog is fetched once and the tracked thread is never suggested.
it('a shared blog with character tags fetches once and hides the tracked thread', async () => {
  const { encryptToken } = await import('../../src/tumblr/oauth')
  const sharedCipher = await encryptToken('token-shared', fixture.env.TOKEN_ENCRYPTION_KEY)
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)').bind('connection-shared', 'a', sharedCipher, sharedCipher, JSON.stringify({ blogs: ['a.tumblr.com'] })).run()
  await fixture.env.DB.prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)').bind('character-a2', 'a', 'Shared').run()
  await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-shared','a','character-a2','connection-shared','a.tumblr.com','shared')").run()
  await seedTrackedThread()

  let notificationCalls = 0
  const result = await fetchActivity('/api/tumblr-activity', url => {
    if (String(url).includes('/notifications')) notificationCalls += 1
    if (String(url).includes('/posts?')) {
      if (String(url).includes('/blog/a.tumblr.com/')) return sideblogReblogRecentPosts()
      return new Response(JSON.stringify({ response: { posts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).includes('/notifications')) return new Response(JSON.stringify({ response: { notifications: [], meta: { total: { notifications: 0, asks: 0, mentions: 0 } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })
  expect(notificationCalls).toBe(1)
  expect(result.threadCandidates).toHaveLength(0)
})
