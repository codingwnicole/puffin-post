import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => {
  fixture = await trackingFixture()
  delete (globalThis as any).__tumblrStubPosts
  delete (globalThis as any).__tumblrStubNotes
}, 30_000)
afterEach(async () => {
  delete (globalThis as any).__tumblrStubPosts
  delete (globalThis as any).__tumblrStubNotes
  await fixture?.dispose()
})

function replyPost(rootBlog: string, rootId = '100', parent = rootBlog) {
  return { reblogged_root_id: rootId, reblogged_root_name: rootBlog, reblogged_from_id: rootId, reblogged_from_name: parent, timestamp: 1_800_000_000 }
}

it("attributes a partner's reply to a starter on the user's connected blog", async () => {
  ;(globalThis as any).__tumblrStubPosts = { 'partner:900': replyPost('a') }
  const response = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/900', title:'' })
  expect(response.status).toBe(201)
  const result = await response.json() as any
  expect(result).toMatchObject({ threadRootId:'100', threadRootBlogId:'a.tumblr.com', starterAuthorStatus:'user', starterAuthorBlogId:'a.tumblr.com', threadRootResolved:1 })
  expect(result.branch).toMatchObject({ status:'your_turn', latestPostId:'900', lastPoster:'partner.tumblr.com' })
})

it('recognizes a root on an authorized but unassigned sideblog', async () => {
  await fixture.env.DB.prepare("UPDATE tumblr_connections SET account_metadata_json=? WHERE id='connection-a'")
    .bind(JSON.stringify({ blogs:['a.tumblr.com','a-side.tumblr.com'], uuids:{'uuid-a':'a.tumblr.com','uuid-side':'a-side.tumblr.com'} })).run()
  ;(globalThis as any).__tumblrStubPosts = { 'partner:901': replyPost('a-side') }
  const response = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/901', title:'' })
  expect((await response.json() as any).starterAuthorStatus).toBe('user')
})

it('recognizes a root on a second connected Tumblr account', async () => {
  const connection = await fixture.env.DB.prepare("SELECT token_encrypted AS token, token_secret_encrypted AS secret FROM tumblr_connections WHERE id='connection-a'").first<{token:string;secret:string}>()
  await fixture.env.DB.prepare('INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json) VALUES (?,?,?,?,?)')
    .bind('connection-a2','a',connection!.token,connection!.secret,JSON.stringify({ blogs:['alt.tumblr.com'], uuids:{'uuid-alt':'alt.tumblr.com'} })).run()
  ;(globalThis as any).__tumblrStubPosts = { 'partner:902': replyPost('alt') }
  const response = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/902', title:'' })
  expect((await response.json() as any).starterAuthorStatus).toBe('user')
})

it("keeps a partner-authored starter distinct from the user's reply", async () => {
  ;(globalThis as any).__tumblrStubPosts = { 'a:903': replyPost('partner', '200', 'partner') }
  const response = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://a.tumblr.com/post/903', title:'' })
  const result = await response.json() as any
  expect(result).toMatchObject({ starterAuthorStatus:'partner', starterAuthorBlogId:'partner.tumblr.com' })
  expect(result.branch).toMatchObject({ status:'their_turn', lastPoster:'a.tumblr.com' })
})

it('does not label an unavailable external root as partner-authored or guess the turn', async () => {
  const originalFetch = globalThis.fetch
  ;(globalThis as any).__tumblrStubPosts = { 'partner:904': { ...replyPost('outside'), reblogged_from_id:null, reblogged_from_name:null } }
  globalThis.fetch = async input => {
    if (String(input).includes('/blog/outside.tumblr.com/posts?id=100')) return new Response('{}', { status:404 })
    return originalFetch(input)
  }
  try {
    const lookup = await fixture.request('/api/starters/resolve', 'POST', { postUrl:'https://partner.tumblr.com/post/904', characterId:'character-a' })
    expect((await lookup.json() as any).starterAuthor.status).toBe('unresolved')
    const missingChoice = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/904', title:'', partnerName:'Writing partner' })
    expect(missingChoice.status).toBe(400)
    const chosen = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/904', title:'', partnerName:'Writing partner', initialTurn:'your_turn' })
    expect(chosen.status).toBe(201)
    expect((await chosen.json() as any).starterAuthorStatus).toBe('unresolved')
  } finally { globalThis.fetch = originalFetch }
})

it('recognizes a renamed authorized blog through its stable Tumblr UUID', async () => {
  await fixture.env.DB.prepare("UPDATE tumblr_connections SET account_metadata_json=? WHERE id='connection-a'")
    .bind(JSON.stringify({ blogs:['new-name.tumblr.com'], uuids:{'permanent-blog-uuid':'new-name.tumblr.com'}, aliases:{'old-name.tumblr.com':'permanent-blog-uuid'} })).run()
  ;(globalThis as any).__tumblrStubPosts = { 'partner:905': replyPost('old-name') }
  const response = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner.tumblr.com/post/905', title:'' })
  expect((await response.json() as any).starterAuthorStatus).toBe('user')
})

it('keeps partner branches separate and preserves the existing manual character and title on repeat imports', async () => {
  ;(globalThis as any).__tumblrStubPosts = { 'partner-one:906': replyPost('a'), 'partner-two:907': replyPost('a') }
  const first = await fixture.request('/api/starters', 'POST', { ...starterInput, postUrl:'https://partner-one.tumblr.com/post/906', title:'' })
  const created = await first.json() as any
  await fixture.request(`/api/starters/${created.id}`, 'PATCH', { title:'My edited scene label' })
  await fixture.env.DB.prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)').bind('character-a2','a','Another character').run()
  const second = await fixture.request('/api/starters', 'POST', { ...starterInput, characterId:'character-a2', postUrl:'https://partner-two.tumblr.com/post/907', title:'' })
  const repeated = await second.json() as any
  expect(repeated.id).toBe(created.id)
  expect(repeated).toMatchObject({ characterId:'character-a', title:'My edited scene label', starterAuthorStatus:'user' })
  expect((await fixture.env.DB.prepare('SELECT COUNT(*) AS count FROM starters').first<{count:number}>())?.count).toBe(1)
  expect((await fixture.env.DB.prepare('SELECT COUNT(*) AS count FROM reply_branches WHERE starter_id=?').bind(created.id).first<{count:number}>())?.count).toBe(2)
})
