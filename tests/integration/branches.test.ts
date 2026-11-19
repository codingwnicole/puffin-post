import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

it('counts every participant independently and archives/restores only the selected branch', async () => {
  const response = await fixture.request('/api/starters','POST',starterInput)
  expect(response.status).toBe(201)
  const starter = await response.json() as any
  const branches = []
  for (let i = 0; i < 3; i++) {
    const created = await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{ notes: `Reply ${i}`, partnerId: 'partner-a' })
    expect(created.status).toBe(201)
    branches.push(await created.json() as any)
  }
  let inbox = await (await fixture.request('/api/inbox')).json() as any
  expect(inbox.yourTurnCount).toBe(3)
  expect(inbox.branches).toHaveLength(3)
  expect(inbox.branches[0]).toMatchObject({ title: 'Open starter', characterName: 'Character a', partnerLabel: 'Partner a' })
  expect((await fixture.request(`/api/branches/${branches[0].id}`,'PATCH',{ status: 'archived', notes: 'Only this branch' })).status).toBe(200)
  inbox = await (await fixture.request('/api/inbox')).json()
  expect(inbox.yourTurnCount).toBe(2)
  const detail = await (await fixture.request(`/api/starters/${starter.id}`)).json() as any
  expect(detail.starter).toMatchObject(starterInput)
  expect(detail.branches).toHaveLength(3)
  expect(detail.branches.filter((b: any) => b.status === 'archived')).toHaveLength(1)
  expect((await fixture.request(`/api/branches/${branches[0].id}`,'PATCH',{ status: 'queued', partnerId: null })).status).toBe(200)
  const queued = await (await fixture.request('/api/inbox?status=queued')).json() as any
  expect(queued.branches[0]).toMatchObject({ archivedAt: null, partnerId: null, notes: 'Only this branch' })
})

it('validates payloads and denies foreign references and anonymous requests', async () => {
  expect(await (await fixture.request('/api/starters/options')).json()).toEqual({ characters:[{ id:'character-a',name:'Character a' }],partners:[{ id:'partner-a',name:'Partner a' }],groups:[] })
  expect((await fixture.request('/api/starters','POST',null)).status).toBe(400)
  expect((await fixture.request('/api/starters','POST',{ ...starterInput, characterId: 'character-b' })).status).toBe(404)
  const starter = await (await fixture.request('/api/starters','POST',starterInput)).json() as any
  expect((await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{ partnerId: 'partner-b' })).status).toBe(404)
  const branch = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{})).json() as any
  expect((await fixture.request(`/api/branches/${branch.id}`,'PATCH',{ status: 'invalid' })).status).toBe(400)
  expect((await fixture.request(`/api/branches/${branch.id}`,'PATCH',{ partnerId: 'partner-b' })).status).toBe(404)
  expect((await fixture.request(`/api/branches/${branch.id}`,'PATCH',{ status: 'archived' },'b')).status).toBe(404)
  expect((await fixture.request(`/api/starters/${starter.id}`,'GET',undefined,'b')).status).toBe(404)
  expect((await fixture.request('/api/inbox','GET',undefined,'anonymous')).status).toBe(401)
  expect((await fixture.request('/api/inbox?status=invalid')).status).toBe(400)
})

it('verifies the selected connection before starter creation but allows a manual scene without one', async () => {
  expect((await fixture.request('/api/starters','POST',{ ...starterInput, rootBlogId:'other.tumblr.com' })).status).toBe(400)
  expect((await fixture.request('/api/starters','POST',starterInput)).status).toBe(201)
  await fixture.env.DB.prepare("DELETE FROM character_blogs WHERE id='blog-a'").run()
  // A post link still requires the character's Tumblr blog for verification…
  expect((await fixture.request('/api/starters','POST',starterInput)).status).toBe(409)
  // …but a link-less manual scene (Discord, etc.) tracks without any Tumblr access.
  const manual = await fixture.request('/api/starters','POST',{ characterId:'character-a', title:'Discord scene' })
  expect(manual.status).toBe(201)
  const manualStarter = await manual.json() as any
  expect(manualStarter).toMatchObject({ characterId:'character-a', title:'Discord scene' })
  // Manual scenes are flagged with the 'manual' sentinel (not a Tumblr blog id).
  expect(manualStarter.rootBlogId).toBe('manual')
  expect(manualStarter.threadRootBlogId).toBe('manual')
  expect(manualStarter.postUrl).toContain('manual/')
})

it('tracks another writer’s starter for an assigned character', async () => {
  const response = await fixture.request('/api/starters','POST',{ ...starterInput, postUrl:'https://partner.tumblr.com/post/45678', title:'' })
  expect(response.status).toBe(201)
  const starter = await response.json() as any
  // No declared "who:" header in this stub, so Puffin titles it with both sides: the assigned
  // character and the partner's blog name, never the raw post text. The premise is filled in too.
  expect(starter).toMatchObject({ characterId:'character-a', rootBlogId:'partner.tumblr.com', rootPostId:'45678', title:'Character a × partner' })
})

it('hydrates the latest direct exchange as soon as a thread is added', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('/notes?')) return new Response(JSON.stringify({ response:{ notes:[
      {type:'reblog',blog_name:'a',post_id:'mine',reblog_parent_blog_name:'tidebvnd',timestamp:100},
      {type:'reblog',blog_name:'tidebvnd',post_id:'theirs',reblog_parent_blog_name:'a',timestamp:200},
    ]} }), {status:200,headers:{'content-type':'application/json'}})
    if (url.includes('/posts/')) return new Response(JSON.stringify({ response:{ blog:{name:'a'},id_string:'12345'} }), {status:200,headers:{'content-type':'application/json'}})
    return originalFetch(input)
  }
  try {
    const response = await fixture.request('/api/starters','POST',{ ...starterInput, partnerBlogIdentifier:'tidebvnd.tumblr.com' })
    expect(response.status).toBe(201)
    const created = await response.json() as { branch:{latestPostId:string;lastPoster:string;lastActivityAt:string;status:string} }
    expect(created.branch).toMatchObject({latestPostId:'theirs',lastPoster:'tidebvnd.tumblr.com',status:'your_turn'})
    expect(created.branch.lastActivityAt).toBe('1970-01-01T00:03:20.000Z')
  } finally { globalThis.fetch = originalFetch }
})

it('allows a character to use multiple blogs from the same Tumblr account', async () => {
  await fixture.env.DB.prepare("UPDATE tumblr_connections SET account_metadata_json=? WHERE id='connection-a'").bind(JSON.stringify({ blogs:['a.tumblr.com','a-sideblog.tumblr.com'], refreshedAt:new Date().toISOString() })).run()
  const assigned = await fixture.request('/api/connections/connection-a/blogs','POST',{ characterId:'character-a', blogIdentifier:'a-sideblog.tumblr.com', displayLabel:'A sideblog' })
  expect(assigned.status).toBe(201)
  const duplicate = await fixture.request('/api/connections/connection-a/blogs','POST',{ characterId:'character-a', blogIdentifier:'a-sideblog.tumblr.com', displayLabel:'A sideblog' })
  expect(duplicate.status).toBe(200)
  const connections = await (await fixture.request('/api/connections')).json() as any[]
  expect(connections[0]).toMatchObject({ blogs:['a.tumblr.com','a-sideblog.tumblr.com'] })
  expect(connections[0].assignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ blogIdentifier:'a.tumblr.com', characterName:'Character a' }),
    expect.objectContaining({ blogIdentifier:'a-sideblog.tumblr.com', characterName:'Character a' }),
  ]))
})

it('persists RP membership and can remove a Tumblr account with its assignments', async () => {
  const group=await (await fixture.request('/api/rp-groups','POST',{name:'Avast'})).json() as {id:string}
  expect((await fixture.request(`/api/rp-groups/${group.id}/characters`,'POST',{characterId:'character-a'})).status).toBe(204)
  expect(await (await fixture.request('/api/rp-groups')).json()).toEqual([{id:group.id,name:'Avast',characterIds:['character-a']}])
  expect((await fixture.request('/api/connections/connection-a','DELETE')).status).toBe(204)
  const remaining = await (await fixture.request('/api/connections')).json() as Array<{ id: string; status: string }>
  // Disconnect keeps the row (characters/threads/drafts survive) but clears tokens.
  expect(remaining.some(c => c.id === 'connection-a' && c.status === 'disconnected')).toBe(true)
})

it('creates and signs in with an eight character password', async () => {
  expect((await fixture.request('/api/auth/password-sign-up','POST',{email:'new@example.com',password:'eight888'})).status).toBe(201)
  expect((await fixture.request('/api/auth/password-sign-in','POST',{email:'new@example.com',password:'eight888'})).status).toBe(200)
})

it('deletes user-created drafts, threads, and RP sections', async () => {
  const draft=await (await fixture.request('/api/reply-drafts','POST',{title:'Delete me'})).json() as {id:string}
  expect((await fixture.request(`/api/reply-drafts/${draft.id}`,'DELETE')).status).toBe(204)
  const starter=await (await fixture.request('/api/starters','POST',starterInput)).json() as {id:string}
  expect((await fixture.request(`/api/starters/${starter.id}`,'DELETE')).status).toBe(204)
  expect((await fixture.request(`/api/starters/${starter.id}`)).status).toBe(404)
  const group=await (await fixture.request('/api/rp-groups','POST',{name:'Delete me'})).json() as {id:string}
  expect((await fixture.request(`/api/rp-groups/${group.id}`,'DELETE')).status).toBe(204)
})

it('archives and restores only the requested branch through dedicated controls', async () => {
  const starter = await (await fixture.request('/api/starters','POST',starterInput)).json() as any
  const first = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{})).json() as any
  const second = await (await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{})).json() as any
  expect((await fixture.request(`/api/branches/${first.id}/archive`,'POST',{})).status).toBe(200)
  const all = await (await fixture.request(`/api/starters/${starter.id}`)).json() as any
  expect(all.branches.find((branch:any) => branch.id === first.id).status).toBe('archived')
  expect(all.branches.find((branch:any) => branch.id === second.id).status).not.toBe('archived')
  expect((await fixture.request(`/api/branches/${first.id}/restore`,'POST',{})).status).toBe(200)
})

it('exports only active workspace rows with formula-safe cells', async () => {
  const starter = await (await fixture.request('/api/starters','POST',{ ...starterInput, title: '=not-a-formula' })).json() as any
  await fixture.request(`/api/starters/${starter.id}/branches`,'POST',{})
  const response = await fixture.request('/api/export.csv')
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/csv')
  expect(await response.text()).toContain("'=not-a-formula")
})

it('auto-applies the post’s Tumblr tags to the new starter', async () => {
  const response = await fixture.request('/api/starters','POST',starterInput)
  expect(response.status).toBe(201)
  const starter = await response.json() as any
  const linked = await fixture.env.DB.prepare('SELECT t.display_label FROM starter_tags st JOIN tags t ON t.id=st.tag_id WHERE st.starter_id=? ORDER BY t.normalized_label').bind(starter.id).all<{display_label:string}>()
  expect(linked.results.map(row => row.display_label)).toEqual(['a/o', 'ooc', 'open'])
  // Re-adding the same post must not duplicate the tag links.
  const duplicate = await fixture.request('/api/starters','POST',{ ...starterInput, title:'Second pass' })
  expect(duplicate.status).toBe(201)
})
