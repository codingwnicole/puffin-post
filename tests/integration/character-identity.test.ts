import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>

beforeAll(async () => { fixture = await trackingFixture() })
afterAll(async () => { await fixture.dispose() })

describe('B01/B02 stable character identity across planner round-trip', () => {
  it('return-to-planner + add-to-cast restores the SAME character row (no duplicate)', async () => {
    // 1. Create a character directly.
    const create = await fixture.request('/api/characters', 'POST', { name: 'Test Character' })
    expect(create.status).toBe(201)
    const { id: characterId } = (await create.json()) as { id: string }

    // 2. Return it to the planner.
    const toPlanner = await fixture.request(`/api/characters/${characterId}/return-to-planner`, 'POST')
    expect(toPlanner.status).toBe(201)
    const { id: planId } = (await toPlanner.json()) as { id: string }

    // The original character should now be in 'hiatus' state (still exists).
    const listAfterReturn = await fixture.request('/api/characters', 'GET')
    expect(listAfterReturn.status).toBe(200)
    const activeChars = (await listAfterReturn.json()) as Array<{ id: string }>
    // Active list should NOT contain the original (it's in hiatus now).
    expect(activeChars.some(c => c.id === characterId)).toBe(false)

    // 3. Add the plan back to cast.
    const toCast = await fixture.request(`/api/character-planner/${planId}/add-to-cast`, 'POST')
    expect(toCast.status).toBe(201)
    const { id: restoredId } = (await toCast.json()) as { id: string }

    // THE KEY ASSERTION: the restored character must be the SAME id as the original.
    expect(restoredId).toBe(characterId)

    // The plan should be gone.
    const plans = await fixture.request('/api/character-planner', 'GET')
    expect(plans.status).toBe(200)
    const planList = (await plans.json()) as Array<{ id: string }>
    expect(planList.some(p => p.id === planId)).toBe(false)

    // The character should be active again.
    const listAfterCast = await fixture.request('/api/characters', 'GET')
    expect(listAfterCast.status).toBe(200)
    const activeAfter = (await listAfterCast.json()) as Array<{ id: string; name: string }>
    const restored = activeAfter.find(c => c.id === characterId)
    expect(restored).toBeDefined()
    expect(restored!.name).toBe('Test Character')
  })

  it('a fresh plan (no source character) still creates a NEW character row', async () => {
    // 1. Create a plan directly.
    const create = await fixture.request('/api/character-planner', 'POST', { name: 'Fresh Idea' })
    expect(create.status).toBe(201)
    const { id: planId } = (await create.json()) as { id: string }

    // 2. Count characters before.
    const before = await fixture.request('/api/characters', 'GET')
    const beforeCount = ((await before.json()) as Array<{ id: string }>).length

    // 3. Add to cast.
    const toCast = await fixture.request(`/api/character-planner/${planId}/add-to-cast`, 'POST')
    expect(toCast.status).toBe(201)
    const { id: newCharacterId } = (await toCast.json()) as { id: string }

    // A NEW character id should be generated.
    expect(newCharacterId).toBeTruthy()

    // Character count should have increased by 1.
    const after = await fixture.request('/api/characters', 'GET')
    const afterChars = (await after.json()) as Array<{ id: string }>
    expect(afterChars.length).toBe(beforeCount + 1)
    expect(afterChars.some(c => c.id === newCharacterId)).toBe(true)
  })
})
