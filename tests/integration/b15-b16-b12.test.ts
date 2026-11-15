import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

interface Starter { id: string; groupId: string | null; archived: number; archivedAt: string | null; premise: string; description: string; branch?: unknown }
interface InboxBranch { starterId: string; groupName: string | null }

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterAll(async () => { await fixture.dispose() })

describe('B15: Thread archive/restore', () => {
  it('should archive a starter and restore it', async () => {
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    expect(created.status).toBe(201)
    const starter = await created.json() as Starter
    expect(starter.archived).toBe(0)

    // Archive the starter
    const archived = await fixture.request(`/api/starters/${starter.id}/archive`, 'POST')
    expect(archived.status).toBe(200)
    const archivedBody = await archived.json() as { starter: Starter }
    expect(archivedBody.starter.archived).toBe(1)
    expect(archivedBody.starter.archivedAt).toBeTruthy()

    // 404 for unknown starter
    const missing = await fixture.request('/api/starters/nope/archive', 'POST')
    expect(missing.status).toBe(404)
  })

  it('should restore an archived starter', async () => {
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    expect(created.status).toBe(201)
    const starter = await created.json() as Starter

    await fixture.request(`/api/starters/${starter.id}/archive`, 'POST')
    const restored = await fixture.request(`/api/starters/${starter.id}/restore`, 'POST')
    expect(restored.status).toBe(200)
    const restoredBody = await restored.json() as { starter: Starter }
    expect(restoredBody.starter.archived).toBe(0)
    expect(restoredBody.starter.archivedAt).toBeNull()
  })
})

describe('B16: Premise editing', () => {
  it('should update starter premise independently from description', async () => {
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    const starter = await created.json() as Starter

    // Update premise
    const updated = await fixture.request(`/api/starters/${starter.id}/premise`, 'PATCH', { premise: 'The world is ending' })
    expect(updated.status).toBe(200)
    const updatedBody = await updated.json() as Starter
    expect(updatedBody.premise).toBe('The world is ending')
    expect(updatedBody.description).toBe('Shared scene') // Original description unchanged
  })
})

describe('B12: Unsorted group fallback', () => {
  it('should apply single RP group membership when starter has no explicit group', async () => {
    // Create an RP group
    const groupCreated = await fixture.request('/api/rp-groups', 'POST', { name: 'Test Group' })
    expect(groupCreated.status).toBe(201)
    const group = await groupCreated.json() as { id: string; name: string }

    // Add character to the group
    const membership = await fixture.request(`/api/rp-groups/${group.id}/characters`, 'POST', { characterId: 'character-a' })
    expect(membership.status).toBe(204)

    // Create starter without explicit group
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    const starter = await created.json() as Starter
    expect(starter.groupId).toBe(group.id)

    // Create a branch so the starter appears in the inbox
    await fixture.request(`/api/starters/${starter.id}/branches`, 'POST', { partnerId: 'partner-a' })

    // Force the unsorted case: clear explicit group so the inbox must fall back to the sole membership
    await fixture.env.DB.prepare('UPDATE starters SET rp_group_id=NULL WHERE id=?').bind(starter.id).run()

    // Check inbox - group name must resolve via single-membership fallback
    const inbox = await fixture.request('/api/inbox')
    const inboxBody = await inbox.json() as { branches: InboxBranch[] }
    const branch = inboxBody.branches.find((b) => b.starterId === starter.id)
    expect(branch).toBeDefined()
    expect(branch!.groupName).toBe('Test Group')
  })
})
