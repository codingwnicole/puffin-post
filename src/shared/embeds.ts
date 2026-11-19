const SPOTIFY_PATH = /^(?:\/intl-[a-z-]+)?\/(playlist|album|track|artist)\/([A-Za-z0-9]{10,40})\/?$/
const YOUTUBE_HOSTS = new Set(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'])
const YOUTUBE_LIST = '[A-Za-z0-9_-]{10,64}'
const APPLE_PATH = /^\/([a-z]{2})\/(playlist|album|song)\/[^/]+\/[^/]+\/?$/
const PIN_RE = /\/pin\/(?:[A-Za-z0-9._-]+--)?(\d{5,25})(?:\/|$)/
const BOARD_RE = /^\/([A-Za-z0-9_.-]{1,60})\/([A-Za-z0-9_.-]{1,60})\/?$/
const BOARD_RESERVED = new Set(['pin','search','ideas','today','explore','settings','business','_'])
export const PINTEREST_HOST = /^([a-z]{2}\.|www\.)?pinterest\.(com|ca|co\.uk|com\.au|de|fr|es|it|jp|com\.mx|nz|ie|at|ch|pt|se|dk|nl|be|ph|cl|co|kr)$/

function httpsUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'https:' ? url : null
  } catch { return null }
}

export function parsePlaylist(input: string): { provider: 'spotify' | 'youtube' | 'apple'; embedUrl: string; openUrl: string } | null {
  const url = httpsUrl(input)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  if (host === 'open.spotify.com') {
    const match = SPOTIFY_PATH.exec(url.pathname)
    if (!match) return null
    return { provider: 'spotify', embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}`, openUrl: `https://open.spotify.com/${match[1]}/${match[2]}` }
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0]
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null
    return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, openUrl: `https://www.youtube.com/watch?v=${id}` }
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const list = url.searchParams.get('list')
    if (list && new RegExp(`^${YOUTUBE_LIST}$`).test(list)) {
      const openHost = host === 'music.youtube.com' ? 'music.youtube.com' : 'www.youtube.com'
      return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, openUrl: `https://${openHost}/playlist?list=${list}` }
    }
    const id = host === 'youtu.be' ? null : url.searchParams.get('v') ?? (/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null)
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      const openHost = host === 'music.youtube.com' ? 'music.youtube.com' : 'www.youtube.com'
      return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, openUrl: `https://${openHost}/watch?v=${id}` }
    }
    return null
  }
  if (host === 'music.apple.com') {
    const match = APPLE_PATH.exec(url.pathname)
    if (!match) return null
    const rest = url.pathname.slice(1).split('/').slice(2, 4).join('/')
    const idParam = url.searchParams.get('i')
    const query = idParam && /^\d+$/.test(idParam) ? `?i=${idParam}` : ''
    const same = `${match[1]}/${match[2]}/${rest}`
    return { provider: 'apple', embedUrl: `https://embed.music.apple.com/${same}${query}`, openUrl: `https://music.apple.com/${same}${query}` }
  }
  return null
}

export function parsePin(input: string): string | null {
  const url = httpsUrl(input)
  if (!url || !PINTEREST_HOST.test(url.hostname.toLowerCase())) return null
  const match = PIN_RE.exec(url.pathname)
  return match ? match[1] : null
}

export function parseBoard(input: string): { user: string; board: string; url: string } | null {
  const url = httpsUrl(input)
  if (!url || !PINTEREST_HOST.test(url.hostname.toLowerCase())) return null
  const match = BOARD_RE.exec(url.pathname)
  if (!match || BOARD_RESERVED.has(match[1])) return null
  return { user: match[1], board: match[2], url: `https://www.pinterest.com/${match[1]}/${match[2]}/` }
}
