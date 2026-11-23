import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'
import { runRefreshBatch } from '../../src/refresh/runner'
import { refreshStarterBranches } from '../../src/tumblr/refresh'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

it('uses the direct reblog chain instead of unrelated notes to decide whose turn it is', async () => {
  const changes:Array<{postId:string;status:string}> = []
  await refreshStarterBranches({ workspaceId:'a',starterId:'s',rootBlogIdentifier:'friend.tumblr.com',ownBlogIdentifiers:['a.tumblr.com'],branches:[{id:'branch',partnerBlogIdentifier:'friend.tumblr.com',latestPostId:null,status:'their_turn',statusManualOverrideAt:null}],activities:[
    {postId:'mine',blogIdentifier:'a.tumblr.com',parentBlogIdentifier:'friend.tumblr.com',timestamp:'2026-01-01T00:00:00.000Z'},
    {postId:'noise',blogIdentifier:'stranger.tumblr.com',parentBlogIdentifier:'friend.tumblr.com',timestamp:'2026-01-02T00:00:00.000Z'},
    {postId:'theirs',blogIdentifier:'friend.tumblr.com',parentBlogIdentifier:'a.tumblr.com',timestamp:'2026-01-03T00:00:00.000Z'},
  ],now:new Date() },async (_branch,activity,status) => { changes.push({postId:activity.postId,status}) })
  expect(changes).toEqual([{postId:'theirs',status:'your_turn'}])
})

it('updates only the branch whose partner posted and preserves a manual status', async () => {
  await fixture.env.DB.batch([
    fixture.env.DB.prepare("UPDATE partners SET blog_identifier='friend.tumblr.com' WHERE id='partner-a'"),
    fixture.env.DB.prepare("INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES ('other','a','other.tumblr.com','Other')"),
  ])
  const starter = await (await fixture.request('/api/starters','POST',starterInput)).json() as { id:string }
  const friend = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{partnerId:'partner-a'})).json() as { id:string }
  const other = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{partnerId:'other'})).json() as { id:string }
  await fixture.request(`/api/branches/${friend.id}`,'PATCH',{status:'queued'})
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ response:{ notes:[{type:'reblog',blog_name:'friend',post_id:'reply-1',reblog_parent_blog_name:'a',timestamp:100}] } }),{status:200,headers:{'content-type':'application/json'}})
  try { await runRefreshBatch(fixture.env,new Date('2026-01-01T00:00:00Z'),10) } finally { globalThis.fetch=originalFetch }
  const branches = await (await fixture.request(`/api/starters/${starter.id}`)).json() as { branches:Array<any> }
  expect(branches.branches.find(branch => branch.id === friend.id)).toMatchObject({status:'queued',latestPostId:'reply-1',refreshError:null})
  expect(branches.branches.find(branch => branch.id === other.id)).toMatchObject({latestPostId:null})
})

it('moves branch to their_turn when user reblogs partner reply to clear obligation', async () => {
  const changes: Array<{ postId: string; status: string }> = []
  await refreshStarterBranches({
    workspaceId: 'a',
    starterId: 's',
    rootBlogIdentifier: 'friend.tumblr.com',
    ownBlogIdentifiers: ['a.tumblr.com'],
    branches: [{ id: 'branch', partnerBlogIdentifier: 'friend.tumblr.com', latestPostId: null, status: 'your_turn', statusManualOverrideAt: null }],
    activities: [
      // Partner replies to user (user's turn)
      { postId: 'partner-reply-1', blogIdentifier: 'friend.tumblr.com', parentBlogIdentifier: 'a.tumblr.com', timestamp: '2026-01-01T00:00:00.000Z' },
      // User reblogs partner's reply (clears obligation, their turn)
      { postId: 'user-reblog-1', blogIdentifier: 'a.tumblr.com', parentBlogIdentifier: 'friend.tumblr.com', timestamp: '2026-01-02T00:00:00.000Z' },
    ],
    now: new Date(),
  }, async (_branch, activity, status) => { changes.push({ postId: activity.postId, status }) })
  // The latest activity should set status to 'their_turn'
  expect(changes).toEqual([{ postId: 'user-reblog-1', status: 'their_turn' }])
})

it('continues syncing archived threads without returning them to active counts or creating duplicates', async () => {
  await fixture.env.DB.prepare("UPDATE partners SET blog_identifier='friend.tumblr.com' WHERE id='partner-a'").run()
  const starter = await (await fixture.request('/api/starters','POST',starterInput)).json() as { id:string }
  const branch = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{partnerId:'partner-a',status:'their_turn'})).json() as { id:string }
  await fixture.request(`/api/starters/${starter.id}/archive`,'POST',{})
  ;(globalThis as any).__tumblrStubNotes={notes:[{type:'reblog',blog_name:'friend',post_id:'reply-archived',reblog_parent_blog_name:'a',timestamp:1763726400}]}
  ;(globalThis as any).__tumblrStubPosts={'friend:reply-archived':{content:[{text:'A new reply arrives while this thread is archived.'}]}}
  try {
    const result=await runRefreshBatch(fixture.env,new Date('2026-11-21T12:00:00.000Z'),10)
    expect(result.refreshed).toBe(2) // counts blogs: the fixture connects one in each of workspaces a and b
    const active=await (await fixture.request('/api/inbox')).json() as {branches:Array<{id:string}>;yourTurnCount:number}
    expect(active).toMatchObject({branches:[],yourTurnCount:0})
    const archived=await (await fixture.request('/api/inbox?archivedOnly=true')).json() as {branches:Array<{id:string;status:string;latestPostId:string;latestReplyExcerpt:string;starterArchived:number}>}
    expect(archived.branches).toHaveLength(1)
    expect(archived.branches[0]).toMatchObject({id:branch.id,status:'your_turn',latestPostId:'reply-archived',latestReplyExcerpt:'A new reply arrives while this thread is archived.',starterArchived:1})
    await fixture.request(`/api/starters/${starter.id}/restore`,'POST',{})
    const restored=await (await fixture.request('/api/inbox')).json() as {branches:Array<{id:string}>;yourTurnCount:number}
    expect(restored.branches.map(item=>item.id)).toEqual([branch.id])
    expect(restored.yourTurnCount).toBe(1)
  } finally {
    delete (globalThis as any).__tumblrStubNotes
    delete (globalThis as any).__tumblrStubPosts
  }
})

it('keeps the last known branch state and records a refresh error when Tumblr fails', async () => {
  await fixture.env.DB.prepare("UPDATE partners SET blog_identifier='friend.tumblr.com' WHERE id='partner-a'").run()
  const starter = await (await fixture.request('/api/starters','POST',starterInput)).json() as { id:string }
  const branch = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{partnerId:'partner-a',status:'their_turn'})).json() as {id:string}
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}',{status:503})
  try { const result=await runRefreshBatch(fixture.env,new Date('2026-01-01T00:00:00Z'),10); expect(result.failed).toBe(1) } finally { globalThis.fetch=originalFetch }
  const details = await (await fixture.request(`/api/starters/${starter.id}`)).json() as { branches:Array<any> }
  expect(details.branches.find(candidate => candidate.id===branch.id)).toMatchObject({status:'their_turn',refreshError:'Tumblr refresh failed (503)'})
})
