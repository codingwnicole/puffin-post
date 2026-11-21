// Item: "Return to planner" moves a cast character to a planner idea (character
// -> hiatus + character_plans row with source_character_id). Undo must restore
// the server state: the character back to active and the planner idea gone.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture?.dispose() })

const state = () => fixture!.env.DB.prepare("SELECT state FROM characters WHERE id='character-a'").first<{ state: string }>()
const plan = () => fixture!.env.DB.prepare('SELECT id,name FROM character_plans WHERE workspace_id=? AND source_character_id=?').bind('a', 'character-a').first<{ id: string; name: string }>()

it('return-to-planner then undo (return-to-cast) restores the active character and removes the plan', async () => {
  // Act: move Character A back to the planner.
  const move = await fixture.request('/api/characters/character-a/return-to-planner', 'POST')
  expect(move.status).toBe(201)
  expect((await state())?.state).toBe('hiatus')
  const created = await plan()
  expect(created).toBeTruthy()
  expect(created?.name).toBe('Character a')

  // Undo: the toast's restore hits the reverse endpoint.
  const undo = await fixture.request('/api/character-planner/return-to-cast/character-a', 'POST')
  expect(undo.status).toBe(200)
  expect((await state())?.state).toBe('active')
  expect(await plan()).toBeNull()
})

it('undoing a character that has no planner idea is a clean 404, not a 500', async () => {
  const undo = await fixture.request('/api/character-planner/return-to-cast/character-a', 'POST')
  expect(undo.status).toBe(404)
})

it('undo keeps a planner idea that existed before the move, and restores a hiatus character to hiatus', async () => {
  await fixture.request('/api/characters/character-a/return-to-planner', 'POST')
  // The character comes back to the cast while its planner idea stays; then it is on hiatus.
  await fixture.env.DB.prepare("UPDATE characters SET state='hiatus' WHERE id='character-a'").run()
  const again = await fixture.request('/api/characters/character-a/return-to-planner', 'POST')
  expect(again.status).toBe(200)
  expect((await again.json() as { created: boolean }).created).toBe(false)
  const undo = await fixture.request('/api/character-planner/return-to-cast/character-a', 'POST', { state: 'hiatus', deletePlan: false })
  expect(undo.status).toBe(200)
  expect((await state())?.state).toBe('hiatus')
  expect(await plan()).toBeTruthy()
})

it('adding one planner idea to the cast twice at once creates one character', async () => {
  const { id } = await (await fixture.request('/api/character-planner', 'POST', { name: 'Twin Click' })).json() as { id: string }
  const responses = await Promise.all([1, 2].map(() => fixture.request(`/api/character-planner/${id}/add-to-cast`, 'POST')))
  expect(responses.map(r => r.status).sort()).toEqual([201, 404])
  expect(await fixture.env.DB.prepare("SELECT COUNT(*) AS n FROM characters WHERE workspace_id='a' AND name='Twin Click'").first()).toEqual({ n: 1 })
})
