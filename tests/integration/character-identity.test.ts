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

  it('a double return-to-planner reuses the same planner idea (no second plan)', async () => {
    const { id } = await (await fixture.request('/api/characters', 'POST', { name: 'Double Click' })).json() as { id: string }
    const first = await (await fixture.request(`/api/characters/${id}/return-to-planner`, 'POST')).json() as { id: string }
    const again = await fixture.request(`/api/characters/${id}/return-to-planner`, 'POST')
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(first.id)
    const n = await fixture.env.DB.prepare('SELECT count(*) AS n FROM character_plans WHERE source_character_id=?').bind(id).first<{ n: number }>()
    expect(n?.n).toBe(1)
  })

  it('deleting a returned idea archives its hidden character instead of leaving a ghost', async () => {
    const { id } = await (await fixture.request('/api/characters', 'POST', { name: 'Would Be Ghost' })).json() as { id: string }
    const plan = await (await fixture.request(`/api/characters/${id}/return-to-planner`, 'POST')).json() as { id: string }
    expect((await fixture.request(`/api/character-planner/${plan.id}`, 'DELETE')).status).toBe(204)
    const row = await fixture.env.DB.prepare('SELECT state FROM characters WHERE id=?').bind(id).first<{ state: string }>()
    expect(row?.state).toBe('archived')
    const archived = await (await fixture.request('/api/characters/archived')).json() as Array<{ id: string }>
    expect(archived.some(c => c.id === id)).toBe(true)
  })

  it('migration 0027 links a pre-fix planner idea to its single hidden character', async () => {
    const { readFileSync } = await import('node:fs')
    await fixture.env.DB.prepare("INSERT INTO characters (id,workspace_id,name,state) VALUES ('legacy-hiatus','a','Legacy Deva','hiatus')").run()
    await fixture.env.DB.prepare("INSERT INTO character_plans (id,workspace_id,name,notes,state) VALUES ('legacy-plan','a','legacy deva ','','developing')").run()
    const sql = readFileSync('src/db/migrations/0027_backfill_plan_source.sql', 'utf8').replace(/^--.*$/gm, '').trim().replace(/;$/, '')
    await fixture.env.DB.prepare(sql).run()
    const plan = await fixture.env.DB.prepare("SELECT source_character_id AS s FROM character_plans WHERE id='legacy-plan'").first<{ s: string | null }>()
    expect(plan?.s).toBe('legacy-hiatus')
    const cast = await (await fixture.request('/api/character-planner/legacy-plan/add-to-cast', 'POST')).json() as { id: string }
    expect(cast.id).toBe('legacy-hiatus')
  })
})
