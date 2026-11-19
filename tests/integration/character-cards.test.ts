import { describe, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'
import { wrap } from '../../src/web/components/TradingCard'

describe('character trading cards', () => {
  it('saves a validated card, returns it with the character list, and stays inside its workspace', async () => {
    const fixture = await trackingFixture()
    try {
      const card = { theme: 'vamp', nickname: 'Little Fox', quote: 'I keep my promises.', favoriteColor: '#aa3344', facts: ['Hates rain'], likes: 'tea', dislikes: 'liars', notes: '' }
      const saved = await fixture.request('/api/characters/character-a/card', 'PUT', card, 'a')
      expect(saved.status).toBe(200)
      const list = await (await fixture.request('/api/characters', 'GET', undefined, 'a')).json() as { id: string; card: Record<string, unknown> | null }[]
      expect(list.find(row => row.id === 'character-a')?.card).toMatchObject({ theme: 'vamp', nickname: 'Little Fox', facts: ['Hates rain'], age: '' })
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, theme: 'nope' }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, favoriteColor: 'red;}' }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, facts: ['1', '2', '3', '4', '5', '6'] }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, extra: 1 }, 'a')).status).toBe(400)
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, symbol: 'sparkle-emoji' }, 'a')).status).toBe(400)
      expect(await (await fixture.request('/api/characters/character-a/card', 'PUT', { ...card, symbol: 'moon' }, 'a')).json()).toMatchObject({ symbol: 'moon' })
      // Another workspace can neither write nor see it.
      expect((await fixture.request('/api/characters/character-a/card', 'PUT', card, 'b')).status).toBe(404)
      const other = await (await fixture.request('/api/characters', 'GET', undefined, 'b')).json() as { id: string }[]
      expect(other.some(row => row.id === 'character-a')).toBe(false)
    } finally { await fixture.dispose() }
  })

  it('wraps card text by width with an ellipsis when cut', () => {
    expect(wrap('one two three four', 9, 2)).toEqual(['one two', 'three…'])
    expect(wrap('short', 20, 3)).toEqual(['short'])
    expect(wrap('', 10, 2)).toEqual([])
  })
})

