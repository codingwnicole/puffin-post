import { describe, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

describe('T4c: archived characters hidden from Inbox', () => {
  it('default inbox excludes archived characters; characterId and includeArchived filters include them', async () => {
    const fixture = await trackingFixture()
    try {
      // A second character in the same workspace; the fixture's character-b belongs to workspace b.
      await fixture.env.DB.prepare('INSERT INTO characters (id, workspace_id, name) VALUES (?,?,?)').bind('character-c', 'a', 'Character c').run()

      // POST /starters auto-creates a your_turn branch for a partner-less manual scene.
      await (await fixture.request('/api/starters', 'POST', { characterId: 'character-a', title: 'Scene a' }, 'a')).json()
      await (await fixture.request('/api/starters', 'POST', { characterId: 'character-c', title: 'Scene c' }, 'a')).json()

      expect((await fixture.request('/api/characters/character-c/archive', 'POST', undefined, 'a')).status).toBe(200)

      const inbox = await (await fixture.request('/api/inbox', 'GET', undefined, 'a')).json() as { branches: { characterId: string }[]; yourTurnCount: number }
      expect(inbox.branches.length).toBe(1)
      expect(inbox.branches[0].characterId).toBe('character-a')
      expect(inbox.yourTurnCount).toBe(1)

      const byArchived = await (await fixture.request('/api/inbox?characterId=character-c', 'GET', undefined, 'a')).json() as { branches: { characterId: string }[] }
      expect(byArchived.branches.length).toBe(1)
      expect(byArchived.branches[0].characterId).toBe('character-c')

      const withArchived = await (await fixture.request('/api/inbox?includeArchived=true', 'GET', undefined, 'a')).json() as { branches: { characterId: string }[] }
      expect(withArchived.branches.length).toBe(2)
    } finally {
      await fixture.dispose()
    }
  })
})
