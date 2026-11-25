import { describe, expect, it } from 'vitest'
import { renderPage } from '../../src/routes/public-share'
import { emptyCard, THEMES } from '../../src/web/components/TradingCard'
import { emptyCharacterProfile } from '../../src/shared/character-profile'

const share = { id: 's', workspaceId: 'w', characterId: 'c', slug: 'publicslug', style: 'card' as const, showMoodboard: 1, showPlaylist: 1, showStats: 1, indexable: 0, previewObjectKey: null, disabledByModerator: 0, publicProfileJson: '{}', publicProfilePublishedAt: null }
const char = { name: 'Wren', iconObjectKey: null, portraitObjectKey: null, cardJson: null }
const stats = { total: 3, mine: 2, theirs: 1, rps: ['Tortuga Harbor', 'The Pit & Beyond'] }
const card = { ...emptyCard(), playlistUrl: 'https://open.spotify.com/playlist/1234567890123456789012', boardUrl: 'https://www.pinterest.com/wren/moodboard/' }

describe('public profile presentation', () => {
  it.each(Object.keys(THEMES) as Array<keyof typeof THEMES>)('uses the saved %s card palette rather than the viewer theme', theme => {
    const html = renderPage(share, char, { ...card, theme }, stats, [], 'https://example.test')
    expect(html).toContain(`--paper:${THEMES[theme].bg[1]}`)
    expect(html).toContain(`--sheet:${THEMES[theme].panel[0]}`)
    expect(html).toContain(`--ink:${THEMES[theme].ink}`)
    expect(html).toContain(`--accent:${THEMES[theme].accent}`)
  })
  it('loads Spotify immediately, stretches the board, and labels turns from the owner perspective', () => {
    const html = renderPage(share, char, card, stats, [], 'https://example.test')
    expect(html).toMatch(/<iframe src="https:\/\/open.spotify.com\/embed\/playlist\//)
    expect(html).not.toContain('Load the Spotify player')
    expect(html).toContain('title="Pinterest moodboard"')
    expect(html).toContain('min-height:580px;height:100%')
    expect(html).toContain('>my turn<')
    expect(html).toContain('MY TURN')
    expect(html).toContain('class="rp-divider"')
    expect(html).not.toMatch(/Stories woven in/i)
    expect(html).toContain('The Pit &amp; Beyond')
    expect(html).not.toMatch(/your turn/i)
  })
  it('shows only the full card name as an italic heading', () => {
    const html = renderPage(share, char, { ...card, nickname: 'Wren Marlowe' }, stats, [], 'https://example.test')
    expect(html).toContain('<h1 class="hero-name"><em>Wren Marlowe</em></h1>')
    expect(html).not.toContain('<p class="hero-nickname">')
  })
  it('still honors the owner’s hidden playlist and moodboard settings', () => {
    const html = renderPage({ ...share, showPlaylist: 0, showMoodboard: 0 }, char, card, stats, [], 'https://example.test')
    expect(html).not.toMatch(/<iframe/)
  })
  it('renders explicitly enabled character sections in the chosen order', () => {
    const profile = emptyCharacterProfile()
    profile.sectionOrder = ['biography', 'introduction', ...profile.sectionOrder.filter(section => !['biography', 'introduction'].includes(section))]
    profile.biography = { enabled: true, text: 'Biography text.' }
    profile.introduction = { enabled: true, text: 'Introduction text.' }
    const html = renderPage(share, char, card, stats, [], 'https://example.test', { profile })
    expect(html.indexOf('>Biography</h2>')).toBeLessThan(html.indexOf('>Introduction</h2>'))
  })
  it('reuses the approved character portrait in a fictional social mini-profile', () => {
    const profile = emptyCharacterProfile()
    profile.social = { ...profile.social, enabled: true, displayName: 'Wren online' }
    const html = renderPage(share, { ...char, portraitObjectKey: 'portrait' }, card, stats, [], 'https://example.test', { profile })
    expect(html).toContain('src="/c/publicslug/portrait" alt="" style="float:right;width:56px')
    expect(html).toContain('A fictional character profile. It is not connected to a real social account.')
  })})
