import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'
import { runRefreshBatch } from '../../src/refresh/runner'
import { rotateAfter } from '../../src/refresh/cursor'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

it('rotates an ordered bounded batch so active blogs do not starve', () => {
  const rows = [{id:'a'},{id:'b'},{id:'c'}]
  expect(rotateAfter(rows, null, 2).map(row => row.id)).toEqual(['a','b'])
  expect(rotateAfter(rows, 'b', 2).map(row => row.id)).toEqual(['c','a'])
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
  globalThis.fetch = async () => new Response(JSON.stringify({ response:{ notes:[{blog_name:'friend',post_id:'reply-1',timestamp:100}] } }),{status:200,headers:{'content-type':'application/json'}})
  try { await runRefreshBatch(fixture.env,new Date('2026-01-01T00:00:00Z'),10) } finally { globalThis.fetch=originalFetch }
  const branches = await (await fixture.request(`/api/starters/${starter.id}`)).json() as { branches:Array<any> }
  expect(branches.branches.find(branch => branch.id === friend.id)).toMatchObject({status:'queued',latestPostId:'reply-1',refreshError:null})
  expect(branches.branches.find(branch => branch.id === other.id)).toMatchObject({latestPostId:null})
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
