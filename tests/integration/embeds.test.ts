import { describe, expect, it } from 'vitest'
import { parsePlaylist, parsePin, parseBoard } from '../../src/shared/embeds'

describe('parsePlaylist', () => {
  it('accepts spotify playlist/album/track/artist with and without intl prefix', () => {
    expect(parsePlaylist('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({
      provider: 'spotify', embedUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', openUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    })
    expect(parsePlaylist('https://open.spotify.com/intl-uk/album/2up3OPjk9HuWQKfDhLJbHr')!.provider).toBe('spotify')
    expect(parsePlaylist('https://open.spotify.com/intl-uk/track/0VjIjW4GlUZAMYb20Fmkoq')!.embedUrl).toBe('https://open.spotify.com/embed/track/0VjIjW4GlUZAMYb20Fmkoq')
    expect(parsePlaylist('https://open.spotify.com/artist/2h93pDCnjQ0zL9UqAIqwS0')!.openUrl).toBe('https://open.spotify.com/artist/2h93pDCnjQ0zL9UqAIqwS0')
  })
  it('accepts youtube lists, watch, shorts, youtu.be, and music.youtube.com', () => {
    expect(parsePlaylist('https://www.youtube.com/playlist?list=PLabc123DEF4567890')!.embedUrl).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PLabc123DEF4567890')
    expect(parsePlaylist('https://m.youtube.com/watch?v=dQw4w9WgXcQ')!.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(parsePlaylist('https://youtu.be/dQw4w9WgXcQ')!.openUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    const music = parsePlaylist('https://music.youtube.com/watch?v=dQw4w9WgXcQ')!
    expect(music.openUrl).toBe('https://music.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(parsePlaylist('https://www.youtube.com/shorts/dQw4w9WgXcQ')!.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })
  it('accepts apple music with cc path and optional i param', () => {
    expect(parsePlaylist('https://music.apple.com/us/playlist/my-mix/pl.abcd1234')!.embedUrl).toBe('https://embed.music.apple.com/us/playlist/my-mix/pl.abcd1234')
    expect(parsePlaylist('https://music.apple.com/de/album/lofi/1440874029?i=1440874030')!.embedUrl).toBe('https://embed.music.apple.com/de/album/lofi/1440874029?i=1440874030')
  })
  it('rejects bad input', () => {
    expect(parsePlaylist('https://open.spotify.com.evil.test/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(parsePlaylist('https://evilspotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(parsePlaylist('http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(parsePlaylist('javascript:alert(1)')).toBeNull()
    expect(parsePlaylist('https://spotify.link/37i9dQZF1DXcBWIGoYBM5M')).toBeNull()
    expect(parsePlaylist('https://pin.it/abc123')).toBeNull()
    expect(parsePlaylist('https://www.youtube.com/')).toBeNull()
    expect(parsePlaylist('not a url')).toBeNull()
  })
})

describe('parsePin', () => {
  it('accepts pinterest pin links', () => {
    expect(parsePin('https://www.pinterest.com/pin/1234567890123456789/')).toBe('1234567890123456789')
    expect(parsePin('https://ca.pinterest.ca/pin/abcdef--123456789/')).toBe('123456789')
    expect(parsePin('https://pinterest.com/pin/9999999/')).toBe('9999999')
    expect(parsePin('https://de.pinterest.de/pin/1234567890123/')).toBe('1234567890123')
  })
  it('rejects bad input', () => {
    expect(parsePin('https://www.pinterest.com/pin/1234/')).toBeNull()
    expect(parsePin('https://pinterest.evil.com/pin/123456789/')).toBeNull()
    expect(parsePin('https://www.pinterest.com/')).toBeNull()
    expect(parsePin('http://www.pinterest.com/pin/123456789/')).toBeNull()
    expect(parsePin('https://www.pinterest.com/board/123456789/')).toBeNull()
    expect(parsePin('pin.it/123456789')).toBeNull()
  })
})

describe('parseBoard', () => {
  it('accepts pinterest board links', () => {
    expect(parseBoard('https://www.pinterest.com/username/my-board/')).toEqual({ user: 'username', board: 'my-board', url: 'https://www.pinterest.com/username/my-board/' })
    expect(parseBoard('https://ca.pinterest.ca/user2/board_name.123')).toEqual({ user: 'user2', board: 'board_name.123', url: 'https://www.pinterest.com/user2/board_name.123/' })
    expect(parseBoard('https://de.pinterest.de/abc/def/')).toEqual({ user: 'abc', board: 'def', url: 'https://www.pinterest.com/abc/def/' })
  })
  it('rejects bad input', () => {
    expect(parseBoard('https://www.pinterest.com/pin/123456789/')).toBeNull()
    expect(parseBoard('https://www.pinterest.com/search/boards/')).toBeNull()
    expect(parseBoard('https://www.pinterest.com/explore/art/')).toBeNull()
    expect(parseBoard('https://pinterest.evil.com/user/board/')).toBeNull()
    expect(parseBoard('http://www.pinterest.com/user/board/')).toBeNull()
    expect(parseBoard('https://www.pinterest.com/user/board/extra/')).toBeNull()
    expect(parseBoard('https://www.pinterest.com/_/board/')).toBeNull()
  })
})
