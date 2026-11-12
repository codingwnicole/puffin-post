import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })
const draftInput = { title: 'Owed DM', notes: 'Keep these notes', sourceUrl: 'https://discord.com/channels/@me/123', reminderAt: '2020-01-01T00:00:00.000Z' }

it('creates optional-reference drafts, filters open/overdue and archives without exposing other workspaces', async () => {
  const response = await fixture.request('/api/reply-drafts','POST',draftInput)
  expect(response.status).toBe(201)
  const draft = await response.json() as any
  expect(draft).toMatchObject({ ...draftInput, characterId: null, partnerId: null, state: 'open' })
  expect(await (await fixture.request('/api/reply-drafts?overdue=true')).json()).toHaveLength(1)
  expect(await (await fixture.request('/api/reply-drafts','GET',undefined,'b')).json()).toEqual([])
  expect((await fixture.request(`/api/reply-drafts/${draft.id}`,'PATCH',{ notes: 'stolen' },'b')).status).toBe(404)
  expect((await fixture.request(`/api/reply-drafts/${draft.id}`,'PATCH',{ state: 'archived' })).status).toBe(200)
  expect(await (await fixture.request('/api/reply-drafts')).json()).toEqual([])
  expect((await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: starterInput })).status).toBe(409)
})

it('converts atomically once under concurrent requests and retries, retaining notes and references', async () => {
  const draft = await (await fixture.request('/api/reply-drafts','POST',{ ...draftInput, characterId: 'character-a', partnerId: 'partner-a' })).json() as any
  const responses = await Promise.all([1,2].map(() => fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: starterInput })))
  expect(responses.map(r => r.status)).toEqual([200,200])
  const conversions = await Promise.all(responses.map(r => r.json()))
  expect(conversions[0]).toEqual(conversions[1])
  const conversion = conversions[0] as any
  expect(conversion.branch).toMatchObject({ notes: draftInput.notes, partnerId: 'partner-a', status: 'your_turn' })
  expect(conversion.draft).toMatchObject({ state: 'converted', convertedStarterId: conversion.starter.id, convertedBranchId: conversion.branch.id })
  const retry = await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: { ...starterInput, title: 'Do not duplicate' } })
  expect(await retry.json()).toEqual(conversion)
  for (const table of ['starters','reply_branches']) expect(await fixture.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).toEqual({ n: 1 })
  expect((await fixture.request(`/api/reply-drafts/${draft.id}`,'PATCH',{ notes: 'change converted' })).status).toBe(409)
  expect((await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: starterInput },'b')).status).toBe(404)
})

it('validates links/references and rolls back an interrupted conversion', async () => {
  expect((await fixture.request('/api/reply-drafts','POST',{ ...draftInput, sourceUrl: 'javascript:alert(1)' })).status).toBe(400)
  expect((await fixture.request('/api/reply-drafts','POST',{ ...draftInput, characterId: 'character-b' })).status).toBe(404)
  const draft = await (await fixture.request('/api/reply-drafts','POST',draftInput)).json() as any
  expect((await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: starterInput, branch: { partnerId: 'partner-b' } })).status).toBe(404)
  expect((await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: { ...starterInput, rootPostId: '' } })).status).toBe(400)
  await fixture.env.DB.exec("CREATE TRIGGER fail_branch BEFORE INSERT ON reply_branches BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;")
  expect((await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{ starter: starterInput })).status).toBe(500)
  expect(await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM starters').first()).toEqual({ n: 0 })
  expect(await fixture.env.DB.prepare('SELECT state,converted_starter_id FROM reply_drafts WHERE id=?').bind(draft.id).first()).toEqual({ state: 'open', converted_starter_id: null })
})

it('edits a draft and converts explicit notes/status, while revoked membership loses access', async () => {
  const draft = await (await fixture.request('/api/reply-drafts','POST',draftInput)).json() as any
  const updated = await fixture.request(`/api/reply-drafts/${draft.id}`,'PATCH',{ title:'Revised',notes:'Revised notes',reminderAt:null,partnerId:'partner-a' })
  expect(await updated.json()).toMatchObject({ title:'Revised',notes:'Revised notes',reminderAt:null,partnerId:'partner-a' })
  const converted = await fixture.request(`/api/reply-drafts/${draft.id}/convert`,'POST',{
    starter:starterInput,branch:{ notes:'Edited during conversion',status:'queued',partnerId:null },
  })
  expect(converted.status).toBe(200)
  expect((await converted.json() as any).branch).toMatchObject({ notes:'Edited during conversion',status:'queued',partnerId:null })
  expect(await (await fixture.request('/api/reply-drafts?state=converted')).json()).toHaveLength(1)
  await fixture.env.DB.prepare("DELETE FROM memberships WHERE workspace_id='a' AND user_id='a'").run()
  expect((await fixture.request('/api/reply-drafts')).status).toBe(403)
})
