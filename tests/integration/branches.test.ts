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
  expect(await (await fixture.request('/api/starters/options')).json()).toEqual({ characters:[{ id:'character-a',name:'Character a' }],partners:[{ id:'partner-a',name:'Partner a' }] })
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
