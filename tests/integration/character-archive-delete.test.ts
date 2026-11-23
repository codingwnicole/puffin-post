import { describe, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'

describe('B03: character archive/restore + safe delete', () => {
  it('archive keeps threads, blogs, RP memberships, quicklinks; hidden from GET /characters; listed in /archived with RP name; restore brings it back', async () => {
    const fixture = await trackingFixture()
    try {
      const groupRes = await fixture.request('/api/rp-groups', 'POST', { name: 'avast' }, 'a')
      expect(groupRes.status).toBe(201)
      const group = await groupRes.json() as { id: string }

      const starterRes = await fixture.request('/api/starters', 'POST', starterInput, 'a')
      expect(starterRes.status).toBe(201)

      const qlRes = await fixture.request('/api/characters/character-a/quicklinks', 'POST', { label: 'gif pack', url: 'https://example.com' }, 'a')
      expect(qlRes.status).toBe(201)

      const joinRes = await fixture.request(`/api/rp-groups/${group.id}/characters`, 'POST', { characterId: 'character-a' }, 'a')
      expect(joinRes.status).toBe(204)

      const before = await fixture.request('/api/characters', 'GET', undefined, 'a')
      const beforeChars = await before.json() as { id: string }[]
      expect(beforeChars.some(c => c.id === 'character-a')).toBe(true)

      const archiveRes = await fixture.request('/api/characters/character-a/archive', 'POST', undefined, 'a')
      expect(archiveRes.status).toBe(200)
      const archiveBody = await archiveRes.json() as { id: string; state: string }
      expect(archiveBody).toEqual({ id: 'character-a', state: 'archived' })

      const afterHide = await fixture.request('/api/characters', 'GET', undefined, 'a')
      const afterHideChars = await afterHide.json() as { id: string }[]
      expect(afterHideChars.some(c => c.id === 'character-a')).toBe(false)

      const archivedRes = await fixture.request('/api/characters/archived', 'GET', undefined, 'a')
      expect(archivedRes.status).toBe(200)
      const archived = await archivedRes.json() as { id: string; name: string; rpGroupNames: string[]; threadCount: number }[]
      expect(archived.length).toBe(1)
      expect(archived[0].id).toBe('character-a')
      expect(archived[0].rpGroupNames).toContain('avast')
      expect(archived[0].threadCount).toBe(1)

      const qlAfter = await fixture.request('/api/characters/character-a/quicklinks', 'GET', undefined, 'a')
      expect(qlAfter.status).toBe(200)
      const qls = await qlAfter.json() as { id: string; label: string }[]
      expect(qls.length).toBe(1)
      expect(qls[0].label).toBe('gif pack')

      const blogRow = await fixture.env.DB.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=?').bind('a', 'character-a').first<{id:string}>()
      expect(blogRow?.id).toBe('blog-a')

      const membershipRow = await fixture.env.DB.prepare('SELECT character_id FROM rp_group_characters WHERE workspace_id=? AND group_id=? AND character_id=?').bind('a', group.id, 'character-a').first<{character_id:string}>()
      expect(membershipRow?.character_id).toBe('character-a')

      const restoreRes = await fixture.request('/api/characters/character-a/restore', 'POST', undefined, 'a')
      expect(restoreRes.status).toBe(200)
      const restoreBody = await restoreRes.json() as { id: string; state: string }
      expect(restoreBody).toEqual({ id: 'character-a', state: 'active' })

      const afterRestore = await fixture.request('/api/characters', 'GET', undefined, 'a')
      const afterRestoreChars = await afterRestore.json() as { id: string }[]
      expect(afterRestoreChars.some(c => c.id === 'character-a')).toBe(true)

      const archivedAfterRestore = await fixture.request('/api/characters/archived', 'GET', undefined, 'a')
      const archivedList = await archivedAfterRestore.json() as { id: string }[]
      expect(archivedList.some(c => c.id === 'character-a')).toBe(false)
    } finally {
      await fixture.dispose()
    }
  })

  it('deleting a character that has quicklinks succeeds, removes rows, reports thread count', async () => {
    const fixture = await trackingFixture()
    try {
      const starterRes = await fixture.request('/api/starters', 'POST', starterInput, 'a')
      expect(starterRes.status).toBe(201)

      const qlRes = await fixture.request('/api/characters/character-a/quicklinks', 'POST', { label: 'icon', url: 'https://example.com' }, 'a')
      expect(qlRes.status).toBe(201)

      const deleteRes = await fixture.request('/api/characters/character-a', 'DELETE', undefined, 'a')
      expect(deleteRes.status).toBe(200)
      const deleteBody = await deleteRes.json() as { deletedThreads: number }
      expect(deleteBody.deletedThreads).toBe(1)

      const chars = await fixture.request('/api/characters', 'GET', undefined, 'a')
      const charList = await chars.json() as { id: string }[]
      expect(charList.some(c => c.id === 'character-a')).toBe(false)
    } finally {
      await fixture.dispose()
    }
  })

  it('user b cannot archive, restore, or delete user a\'s character (404)', async () => {
    const fixture = await trackingFixture()
    try {
      const archiveRes = await fixture.request('/api/characters/character-a/archive', 'POST', undefined, 'b')
      expect(archiveRes.status).toBe(404)

      const restoreRes = await fixture.request('/api/characters/character-a/restore', 'POST', undefined, 'b')
      expect(restoreRes.status).toBe(404)

      const deleteRes = await fixture.request('/api/characters/character-a', 'DELETE', undefined, 'b')
      expect(deleteRes.status).toBe(404)
    } finally {
      await fixture.dispose()
    }
  })

  it('a character on hiatus can be archived, and archiving twice is a 404', async () => {
    const fixture = await trackingFixture()
    try {
      const paused = await fixture.request('/api/characters/character-a', 'PATCH', { state: 'hiatus' }, 'a')
      expect(paused.status).toBe(200)
      const archiveRes = await fixture.request('/api/characters/character-a/archive', 'POST', undefined, 'a')
      expect(archiveRes.status).toBe(200)
      expect(await archiveRes.json()).toEqual({ id: 'character-a', state: 'archived' })
      const archived = await (await fixture.request('/api/characters/archived', 'GET', undefined, 'a')).json() as { id: string }[]
      expect(archived.map(c => c.id)).toContain('character-a')
      const again = await fixture.request('/api/characters/character-a/archive', 'POST', undefined, 'a')
      expect(again.status).toBe(404)
    } finally {
      await fixture.dispose()
    }
  })
})
