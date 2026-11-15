import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

interface Starter { id: string; groupId: string | null; archived: number; archivedAt: string | null; premise: string; description: string; branch?: unknown }
interface InboxBranch { starterId: string; groupId: string | null; groupName: string | null; rpUnsortedReason: string }

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
    const groupCreated = await fixture.request('/api/rp-groups', 'POST', { name: 'Test Group' })
    expect(groupCreated.status).toBe(201)
    const group = await groupCreated.json() as { id: string; name: string }
    const membership = await fixture.request(`/api/rp-groups/${group.id}/characters`, 'POST', { characterId: 'character-a' })
    expect(membership.status).toBe(204)
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    const starter = await created.json() as Starter
    expect(starter.groupId).toBe(group.id)
    await fixture.request(`/api/starters/${starter.id}/branches`, 'POST', { partnerId: 'partner-a' })
    await fixture.env.DB.prepare('UPDATE starters SET rp_group_id=NULL WHERE id=?').bind(starter.id).run()
    const inbox = await fixture.request('/api/inbox')
    const inboxBody = await inbox.json() as { branches: InboxBranch[] }
    const branch = inboxBody.branches.find((b) => b.starterId === starter.id)
    expect(branch).toBeDefined()
    expect(branch!.groupId).toBe(group.id)
    expect(branch!.groupName).toBe('Test Group')
    expect(branch!.rpUnsortedReason).toBe('none')
  })

  it('should return groupId null and multiple_rps reason for two memberships', async () => {
    const g1 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group One' })).json()) as { id: string }
    const g2 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group Two' })).json()) as { id: string }
    await fixture.request(`/api/rp-groups/${g1.id}/characters`, 'POST', { characterId: 'character-a' })
    await fixture.request(`/api/rp-groups/${g2.id}/characters`, 'POST', { characterId: 'character-a' })
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    const starter = await created.json() as Starter
    expect(starter.groupId).toBeNull()
    await fixture.request(`/api/starters/${starter.id}/branches`, 'POST', { partnerId: 'partner-a' })
    const inbox = await fixture.request('/api/inbox')
    const inboxBody = await inbox.json() as { branches: InboxBranch[] }
    const branch = inboxBody.branches.find((b) => b.starterId === starter.id)
    expect(branch).toBeDefined()
    expect(branch!.groupId).toBeNull()
    expect(branch!.groupName).toBeNull()
    expect(branch!.rpUnsortedReason).toBe('multiple_rps')
  })

  it('should let an explicit group override the fallback', async () => {
    const g1 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group One' })).json()) as { id: string }
    const g2 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group Two' })).json()) as { id: string }
    await fixture.request(`/api/rp-groups/${g1.id}/characters`, 'POST', { characterId: 'character-a' })
    await fixture.request(`/api/rp-groups/${g2.id}/characters`, 'POST', { characterId: 'character-a' })
    const created = await fixture.request('/api/starters', 'POST', { ...starterInput, groupId: g1.id })
    const starter = await created.json() as Starter
    expect(starter.groupId).toBe(g1.id)
    await fixture.request(`/api/starters/${starter.id}/branches`, 'POST', { partnerId: 'partner-a' })
    const inbox = await fixture.request('/api/inbox')
    const inboxBody = await inbox.json() as { branches: InboxBranch[] }
    const branch = inboxBody.branches.find((b) => b.starterId === starter.id)
    expect(branch).toBeDefined()
    expect(branch!.groupId).toBe(g1.id)
    expect(branch!.groupName).toBe('Group One')
    expect(branch!.rpUnsortedReason).toBe('none')
  })

  it('should persist group assignment via the thread endpoint', async () => {
    const g1 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group One' })).json()) as { id: string }
    const g2 = (await (await fixture.request('/api/rp-groups', 'POST', { name: 'Group Two' })).json()) as { id: string }
    await fixture.request(`/api/rp-groups/${g1.id}/characters`, 'POST', { characterId: 'character-a' })
    await fixture.request(`/api/rp-groups/${g2.id}/characters`, 'POST', { characterId: 'character-a' })
    const created = await fixture.request('/api/starters', 'POST', starterInput)
    const starter = await created.json() as Starter
    expect(starter.groupId).toBeNull()
    const assigned = await fixture.request(`/api/rp-groups/threads/${starter.id}`, 'POST', { groupId: g2.id })
    expect(assigned.status).toBe(204)
    // Verify the DB was updated
    const dbRow = await fixture.env.DB.prepare('SELECT rp_group_id AS rpGroupId FROM starters WHERE id=?').bind(starter.id).first() as { rpGroupId: string | null }
    expect(dbRow.rpGroupId).toBe(g2.id)
    // Now create a branch so it appears in the inbox
    await fixture.request(`/api/starters/${starter.id}/branches`, 'POST', { partnerId: 'partner-a' })
    const inbox = await fixture.request('/api/inbox')
    const inboxBody = await inbox.json() as { branches: InboxBranch[] }
    const branch = inboxBody.branches.find((b) => b.starterId === starter.id)
    expect(branch).toBeDefined()
    expect(branch!.groupId).toBe(g2.id)
    expect(branch!.groupName).toBe('Group Two')
    expect(branch!.rpUnsortedReason).toBe('none')
  })
})
