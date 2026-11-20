import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { CARD_SYMBOLS, SYMBOL_FONT, type CardSymbol } from '../../shared/card-symbols'

// A collectible card for a character, drawn as plain SVG so the same markup is shown on the page
// and rasterised for the download (no foreignObject, no dependencies). Three logical sides — front,
// back, and the moodboard — ride on two physical faces: the hidden face is refilled with the next
// side just before the card rotates.
// Palettes adapted from the Character Card Studio brief; per-theme ornament art was left out.

export type CardProfile = { theme: ThemeId; nickname: string; age: string; birthdate: string; quote: string; song: string; artist: string; favoriteColor: string; facts: string[]; likes: string; dislikes: string; notes: string; playlistUrl: string; boardUrl: string; tracklist: string[]; symbol?: CardSymbol }
export type CardStats = { total: number; mine: number; theirs: number; rps: string[] }
type Theme = { label: string; group: string; font: string; sans: string; corner: number; ink: string; sub: string; accent: string; stroke: string; panel: [string, string]; bg: [string, string, string]; foil: string[] }

export const THEMES = {
  holo: { label: 'Holo Noir', group: 'Modern', font: 'Georgia,serif', sans: 'Arial,sans-serif', corner: 12, ink: '#fff0f5', sub: '#e3bfd3', accent: '#e5b5cf', stroke: '#c99abc', panel: ['#402537', '#19121f'], bg: ['#26172b', '#0e0c16', '#382333'], foil: ['#f9c9d3', '#bd99fb', '#fff2d8', '#93b5e1', '#d990c4'] },
  vamp: { label: 'Vamp Romantic', group: 'Dark / Romantic', font: 'Georgia,serif', sans: 'Arial,sans-serif', corner: 3, ink: '#fff1e6', sub: '#d9a8a8', accent: '#e1ad84', stroke: '#b17a64', panel: ['#47141f', '#17090f'], bg: ['#2b0812', '#0d0509', '#33101a'], foil: ['#d7b181', '#7e3438', '#f8dfab', '#541720', '#ffe1b4'] },
  poet: { label: 'Poetcore', group: 'Editorial', font: 'Palatino Linotype,Book Antiqua,Georgia,serif', sans: 'Courier New,monospace', corner: 2, ink: '#30251f', sub: '#735d4c', accent: '#82543e', stroke: '#9a7559', panel: ['#f3e3c9', '#ead5b2'], bg: ['#f5e7cf', '#d9bd91', '#f6e9d5'], foil: ['#c39d62', '#e8cb92', '#a77447', '#faefcf', '#b48a58'] },
  coquette: { label: 'Coquette', group: 'Romantic', font: 'Georgia,serif', sans: 'Arial,sans-serif', corner: 18, ink: '#542e42', sub: '#945c78', accent: '#b75c8d', stroke: '#cf80a5', panel: ['#fbe5ee', '#f4c4d9'], bg: ['#fff0f5', '#efc0d5', '#fff7f9'], foil: ['#f9d2e5', '#fff7f8', '#d69bbc', '#eab4cd', '#df9bbf'] },
  cyber: { label: 'Y2K Chrome', group: 'Modern', font: 'Arial,sans-serif', sans: 'Arial,sans-serif', corner: 1, ink: '#ebfff9', sub: '#8beed8', accent: '#44f5d2', stroke: '#35b4c7', panel: ['#083644', '#06101d'], bg: ['#08132d', '#070810', '#1e0c38'], foil: ['#e1fbff', '#6ee8ff', '#c0b0ff', '#49ffdf', '#8454ea'] },
  whimsy: { label: 'Whimsigoth', group: 'Fantasy', font: 'Palatino Linotype,Georgia,serif', sans: 'Arial,sans-serif', corner: 8, ink: '#ffedcf', sub: '#dac1c3', accent: '#e6be7e', stroke: '#aa899e', panel: ['#3f284b', '#1b142b'], bg: ['#261835', '#12101c', '#422745'], foil: ['#edd5a5', '#8d6aa8', '#f9ead8', '#cc9dbf', '#dcb983'] },
  ice: { label: 'Cool Blue', group: 'Modern', font: 'Arial,sans-serif', sans: 'Arial,sans-serif', corner: 14, ink: '#193c59', sub: '#527890', accent: '#447ca5', stroke: '#81b4d0', panel: ['#ecf9ff', '#c5e6f5'], bg: ['#eaf9ff', '#c0e2ef', '#f9ffff'], foil: ['#86b9d6', '#fafdff', '#aed4ea', '#70a4d0', '#e0f4ff'] },
  wild: { label: 'Wilderkind', group: 'Nature', font: 'Palatino Linotype,Georgia,serif', sans: 'Arial,sans-serif', corner: 8, ink: '#35422e', sub: '#687b55', accent: '#6f854a', stroke: '#82956c', panel: ['#f2efdc', '#d8e2c7'], bg: ['#f3f2df', '#cfd9bc', '#faf5e8'], foil: ['#7b956f', '#e5d4a9', '#b0c3a5', '#7ca7a0', '#fff5dc'] },
  crime: { label: 'Casefile Noir', group: 'Dark / Gritty', font: 'Arial,sans-serif', sans: 'Courier New,monospace', corner: 4, ink: '#e6e1d6', sub: '#aca69c', accent: '#a96055', stroke: '#666a72', panel: ['#24292f', '#0f1116'], bg: ['#1a1d22', '#0c0d11', '#252930'], foil: ['#cbc5b9', '#4d5158', '#83685b', '#dfd8c8', '#5e646c'] },
  deco: { label: 'Neo Deco', group: 'Editorial', font: 'Georgia,serif', sans: 'Arial,sans-serif', corner: 0, ink: '#fff3dc', sub: '#dbcb9c', accent: '#d6b870', stroke: '#b5a16d', panel: ['#17453f', '#091f22'], bg: ['#0a2e2b', '#071516', '#153a35'], foil: ['#f3d6a0', '#59867a', '#f1e1b3', '#a38246', '#ffe4a4'] },
} satisfies Record<string, Theme>
export type ThemeId = keyof typeof THEMES

export const emptyCard = (): CardProfile => ({ theme: 'holo', nickname: '', age: '', birthdate: '', quote: '', song: '', artist: '', favoriteColor: '#b07a9e', facts: ['', '', '', '', ''], likes: '', dislikes: '', notes: '', playlistUrl: '', boardUrl: '', tracklist: [], symbol: 'none' })

/** Keeps cards made before newer fields existed usable everywhere they render. */
export function normalizeCard(value: Partial<CardProfile> | null | undefined): CardProfile {
  const card = { ...emptyCard(), ...value }
  return { ...card, facts: Array.isArray(value?.facts) ? value.facts.slice(0, 5).map(fact => String(fact ?? '')) : emptyCard().facts, tracklist: Array.isArray(value?.tracklist) ? value.tracklist.map(track => String(track ?? '')) : [] }
}

// ponytail: char-count heuristic, upgrade to measureText when SVG is in a DOM
function fitSize(text: string, maxChars: number, maxFont: number, minFont: number): number {
  const ratio = Math.min(1, maxChars / Math.max(1, text.length))
  return Math.max(minFont, Math.round(maxFont * ratio))
}

/** Greedy word wrap by character count; the last line gets an ellipsis when text is cut. */
export function wrap(text: string, width: number, lines: number) {
  const out: string[] = []; let line = ''
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if ((line + ' ' + word).trim().length <= width) { line = (line + ' ' + word).trim(); continue }
    if (line) out.push(line)
    line = word.slice(0, width)
    if (out.length === lines) break
  }
  if (line && out.length < lines) out.push(line)
  if (out.length === lines && out.join(' ').length < text.trim().length) out[lines - 1] = out[lines - 1].slice(0, width - 1) + '…'
  return out
}

/** The Pinterest board slug in a "user/board" URL → "board" (dashes as spaces). */
export function boardLabel(url: string): string {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ?? '' } catch { return '' }
}

export function Side({ side, name, profile, stats, portrait, moodboard = [], uid }: { side: 'front' | 'back' | 'mood'; name: string; profile: CardProfile; stats: CardStats; portrait: string | null; moodboard?: string[]; uid: string }) {
  const t: Theme = THEMES[profile.theme] ?? THEMES.holo
  const id = (key: string) => `${uid}-${side}-${key}`
  const label = { fill: t.sub, fontFamily: t.sans, fontSize: 12, letterSpacing: 3 } as const
  const body = { fill: t.ink, fontFamily: t.font }
  const box = (y: number, h: number, extra?: object) => <rect x={40} y={y} width={560} height={h} rx={Math.min(t.corner, 14)} fill={`url(#${id('panel')})`} stroke={t.stroke} strokeOpacity={.7} filter={`url(#${id('shadow')})`} {...extra} />
  // The writer's chosen symbol (none by default) sits beside the name, on the fun-fact bullets and in the footer.
  const glyph: string = CARD_SYMBOLS[profile.symbol ?? 'none']?.glyph ?? ''
  const symbolText = (x: number, y: number, size: number) => <text x={x} y={y} textAnchor="middle" fill={t.accent} fontFamily={SYMBOL_FONT} fontSize={size} data-symbol>{glyph}</text>
  const initials = name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
  const moodTiles = moodboard.slice(0, 12)
  const board = profile.boardUrl ? boardLabel(profile.boardUrl) : ''
  const tracks = profile.tracklist.slice(0, 3)
  const hasThemeSong = Boolean(profile.song.trim() || profile.artist.trim())
  const favoriteY = hasThemeSong ? 762 : 694
  return <svg viewBox="0 0 640 860" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${name}'s card, ${side}`} data-side={side}>
    <defs>
      <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">{t.bg.map((c, i) => <stop key={i} offset={i / 2} stopColor={c} />)}</linearGradient>
      <linearGradient id={id('foil')} x1="0" y1="0" x2="1" y2="1">{t.foil.map((c, i) => <stop key={i} offset={i / (t.foil.length - 1)} stopColor={c} />)}</linearGradient>
      <linearGradient id={id('panel')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={t.panel[0]} stopOpacity={.92} /><stop offset="1" stopColor={t.panel[1]} stopOpacity={.92} /></linearGradient>
      <filter id={id('shadow')}><feDropShadow dx="0" dy="2" stdDeviation="4" floodColor={t.panel[1]} floodOpacity=".4" /></filter>
      {side === 'front' && <clipPath id={id('portrait')}><rect x={40} y={70} width={560} height={330} rx={Math.min(t.corner * 2, 40)} /></clipPath>}
      {side === 'mood' && Array.from({ length: 12 }, (_, i) => { const x = 40 + (i % 3) * 192, y = 70 + Math.floor(i / 3) * 155; return <clipPath key={i} id={id('tile' + i)}><rect x={x} y={y} width={186} height={149} rx={Math.min(t.corner, 12)} /></clipPath> })}
    </defs>
    <rect x={6} y={6} width={628} height={848} rx={t.corner + 14} fill={`url(#${id('bg')})`} stroke={`url(#${id('foil')})`} strokeWidth={10} />
    <rect x={20} y={20} width={600} height={820} rx={t.corner + 6} fill="none" stroke={t.stroke} strokeOpacity={.55} />
    <text x={44} y={50} {...label}>{side === 'front' ? 'CHARACTER CARD ///' : side === 'back' ? 'CHARACTER DETAILS ///' : 'MOODBOARD ///'}</text>
    <text x={596} y={50} textAnchor="end" {...label}>PUFFIN POST</text>
    {glyph && symbolText(320, 832, 18)}
    {side === 'front' ? <>
      <g clipPath={`url(#${id('portrait')})`}>
        <rect x={40} y={70} width={560} height={330} fill={`url(#${id('panel')})`} />
        {portrait ? <image href={portrait} x={40} y={70} width={560} height={330} preserveAspectRatio="xMidYMid slice" /> : <text x={320} y={262} textAnchor="middle" fill={t.accent} fontFamily={t.font} fontSize={110}>{initials}</text>}
      </g>
      <rect x={40} y={70} width={560} height={330} rx={Math.min(t.corner * 2, 40)} fill="none" stroke={`url(#${id('foil')})`} strokeWidth={3} />
      {box(420, 70, { stroke: `url(#${id('foil')})`, strokeOpacity: 1, strokeWidth: 2 })}
      {glyph && symbolText(74, 468, 30)}
      {(() => { const display = profile.nickname || name; return <text x={glyph ? 104 : 62} y={468} {...body} fontSize={fitSize(display, 16, 40, 22)}>{display.slice(0, 34)}</text> })()}
      {box(506, 44)}<text x={60} y={533} {...label}>AGE</text><text x={120} y={534} {...body} fontSize={17}>{profile.age || '—'}</text><text x={330} y={533} {...label}>BIRTHDATE</text><text x={440} y={534} {...body} fontSize={17}>{profile.birthdate || '—'}</text>
      {box(562, 120)}<text x={56} y={596} fill={t.accent} fontFamily={t.font} fontSize={34}>"</text>
      {(() => { const q = profile.quote || 'A line that captures them.'; const fs = fitSize(q, 60, 22, 13); const lh = Math.round(fs * 1.35); const lines = wrap(q, Math.round(46 * 18 / fs), 4); const start = 622 - (lines.length - 1) * lh / 2; return lines.map((line, i) => <text key={i} x={320} y={start + i * lh} textAnchor="middle" {...body} fontStyle="italic" fontSize={fs}>{line}</text>) })()}
      {hasThemeSong && <>{box(694, 56)}<circle cx={70} cy={722} r={15} fill="none" stroke={t.ink} strokeWidth={2} /><path d="M65 714l13 8-13 8z" fill={t.ink} />
      <text x={98} y={716} {...label}>THEME SONG</text>{(() => { const songLine = profile.song + (profile.artist ? ' - ' + profile.artist : ''); return <text x={98} y={738} {...body} fontSize={fitSize(songLine, 40, 16, 11)}>{songLine.slice(0, 60)}</text> })()}
      {Array.from({ length: 22 }, (_, i) => { const h = 6 + ((i * 7) % 11) * 2; return <rect key={i} x={460 + i * 6} y={722 - h / 2} width={3} height={h} fill={t.sub} opacity={.8} /> })}</>}
      {box(favoriteY, 44)}<text x={60} y={favoriteY + 27} {...label}>FAVORITE COLOR</text><rect x={430} y={favoriteY + 10} width={150} height={24} rx={6} fill={profile.favoriteColor} stroke={t.ink} strokeOpacity={.5} />
    </> : side === 'back' ? <>
      {box(70, 200)}<text x={60} y={100} {...label}>THREAD STATS</text>
      {([['THREADS', stats.total], ['YOUR TURN', stats.mine], ['THEIR TURN', stats.theirs]] as const).map(([what, value], i) => <g key={what}><text x={133 + i * 187} y={185} textAnchor="middle" fill={t.ink} fontFamily={t.font} fontSize={64}>{value}</text><text x={133 + i * 187} y={215} textAnchor="middle" {...label}>{what}</text></g>)}
      <text x={320} y={252} textAnchor="middle" {...body} fontSize={15}>{wrap(stats.rps.length ? 'Writes in ' + stats.rps.join(' / ') : 'Not in an RP section yet', 60, 1)[0]}</text>
      {box(286, 250)}<text x={60} y={316} {...label}>FUN FACTS</text>
      {(() => { const facts = [0,1,2,3,4].map(i => (profile.facts[i] || '—').slice(0, 60)); let fs = 17; let wr: string[][] = []; for (; fs >= 11; fs--) { wr = facts.map(f => wrap(f, Math.round(42 * 17 / fs), 2)); if (wr.reduce((s, l) => s + l.length, 0) * Math.round(fs * 1.4) <= 180) break } const lh = Math.round(fs * 1.4); let y = 358; return facts.map((_, i) => { const sy = y; y += wr[i].length * lh + 2; return <g key={i}>{glyph ? symbolText(66, sy, 16) : <circle cx={66} cy={sy - 6} r={3} fill={t.accent} />}{wr[i].map((line, j) => <text key={j} x={88} y={sy + j * lh} {...body} fontSize={fs}>{line}</text>)}</g> }) })()}
      {box(552, 120, { width: 272 })}{box(552, 120, { x: 328, width: 272 })}
      <text x={60} y={580} {...label}>LIKES</text><text x={348} y={580} {...label}>DISLIKES</text>
      {wrap(profile.likes || '—', 24, 3).map((line, i) => <text key={'l' + i} x={60} y={608 + i * 22} {...body} fontSize={17}>{line}</text>)}
      {wrap(profile.dislikes || '—', 24, 3).map((line, i) => <text key={'d' + i} x={348} y={608 + i * 22} {...body} fontSize={17}>{line}</text>)}
      {box(688, 150)}<text x={60} y={718} {...label}>MISC. / NOTES</text>
      {wrap(profile.notes || '—', 54, 4).map((line, i) => <text key={i} x={60} y={748 + i * 24} {...body} fontSize={17}>{line}</text>)}
    </> : <>
      {moodTiles.length > 0 ? <>
        {Array.from({ length: 12 }, (_, i) => {
          const x = 40 + (i % 3) * 192, y = 70 + Math.floor(i / 3) * 155
          return moodTiles[i]
            ? <g key={i} clipPath={`url(#${id('tile' + i)})`}><rect x={x} y={y} width={186} height={149} fill={`url(#${id('panel')})`} /><image href={moodTiles[i]} x={x} y={y} width={186} height={149} preserveAspectRatio="xMidYMid slice" data-moodboard /></g>
            : <rect key={i} x={x} y={y} width={186} height={149} rx={Math.min(t.corner, 12)} fill={`url(#${id('panel')})`} opacity={.35} />
        })}
        {board ? wrap('Full board: ' + board, 70, 1).map((line, i) => <text key={i} x={320} y={712} textAnchor="middle" {...body} fontSize={15}>{line}</text>) : null}
        {tracks.length > 0 && <>
          <text x={44} y={750} {...label}>PLAYLIST</text>
          {tracks.map((track, i) => <text key={i} x={44} y={778 + i * 24} {...body} fontSize={16}>{wrap(track, 68, 1)[0]}</text>)}
        </>}
      </> : <>
        {box(70, 340)}
        {board ? <><text x={320} y={160} textAnchor="middle" {...label}>PINTEREST BOARD</text>{wrap(board, 50, 2).map((line, i) => <text key={i} x={320} y={195 + i * 28} textAnchor="middle" {...body} fontSize={20}>{line}</text>)}</> : null}
        {profile.playlistUrl ? <><text x={320} y={board ? 280 : 160} textAnchor="middle" {...label}>PLAYLIST</text><text x={320} y={board ? 310 : 195} textAnchor="middle" {...body} fontSize={16}>{wrap(profile.playlistUrl.replace(/^https?:\/\//, ''), 50, 1)[0]}</text></> : null}
        {tracks.length > 0 && <>
          {box(board || profile.playlistUrl ? 430 : 70, 40 + tracks.length * 28)}
          <text x={60} y={(board || profile.playlistUrl ? 460 : 100)} {...label}>TRACKLIST</text>
          {tracks.map((track, i) => <text key={i} x={60} y={(board || profile.playlistUrl ? 492 : 132) + i * 28} {...body} fontSize={17}>{wrap(track, 60, 1)[0]}</text>)}
        </>}
      </>}
    </>}
  </svg>
}

/** Flip on click / Enter / Space; tilt and foil shine follow the pointer (off under reduced motion via CSS).
 * With moodboard images the click cycles front -> back -> moodboard: the hidden face is refilled with
 * the next side just before the rotation, so the two physical faces always hold the current and next
 * side. The aria-label names the side that comes next. */
export default function TradingCard({ name, profile, stats, portrait, moodboard, initialSide = 'front' }: { name: string; profile: CardProfile; stats: CardStats; portrait: string | null; moodboard?: string[]; initialSide?: 'front' | 'back' }) {
  const hasMoodboard = (moodboard?.length ?? 0) > 0 || !!profile.boardUrl || !!profile.playlistUrl || (profile.tracklist?.length ?? 0) > 0
  const [visible, setVisible] = useState<'front' | 'back' | 'mood'>(initialSide)
  const [hidden, setHidden] = useState<'front' | 'back' | 'mood'>(initialSide === 'front' ? 'back' : 'front')
  const flipped = visible !== 'front'
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height
    event.currentTarget.style.setProperty('--rx', `${(0.5 - y) * 14}deg`); event.currentTarget.style.setProperty('--ry', `${(x - 0.5) * 18}deg`)
    event.currentTarget.style.setProperty('--mx', `${x * 100}%`); event.currentTarget.style.setProperty('--my', `${y * 100}%`)
  }
  const leave = (event: PointerEvent<HTMLDivElement>) => { for (const key of ['--rx', '--ry', '--mx', '--my']) event.currentTarget.style.removeProperty(key) }
  // One face renderer: a given side drawn on whichever physical face it currently rides.
  const face = (side: 'front' | 'back' | 'mood') => <Side side={side} name={name} profile={profile} stats={stats} portrait={side === 'front' ? portrait : null} moodboard={side === 'mood' ? moodboard : undefined} uid={uid} />
  return <div className="tcard" data-theme-id={profile.theme} data-flipped={flipped || undefined} data-visible={visible} onPointerMove={move} onPointerLeave={leave} style={{ '--card-glow': THEMES[profile.theme]?.accent } as CSSProperties}>
    <button type="button" className="tcard-inner" aria-pressed={flipped} aria-label={`Flip ${name}'s card to the ${hidden === 'mood' ? 'moodboard' : hidden}`} onClick={() => {
      if (!hasMoodboard) { setVisible(s => (s === 'front' ? 'back' : 'front')); return }
      const nextVisible = visible === 'front' ? 'back' : visible === 'back' ? 'mood' : 'front'
      const nextHidden = nextVisible === 'front' ? 'back' : nextVisible === 'back' ? 'mood' : 'front'
      setVisible(nextVisible); setHidden(nextHidden)
    }}>
      <span className="tcard-flip">
      {/* The unflipped face (no rotation) shows the visible side; the rotated face shows the other. */}
      <span className="tcard-face tcard-front">{face(visible)}</span>
      <span className="tcard-face tcard-back">{face(hidden)}</span>
      {/* A raster-only copy of the mood side, kept in the DOM (hidden) so the download can draw it. */}
      {hasMoodboard && <span className="tcard-face tcard-mood" hidden>{face('mood')}</span>}
      </span>
    </button>
  </div>
}

const blobToData = (blob: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not draw the card')); img.src = url })
// First frame of an animated GIF as a PNG data URL (the card shows only that frame).
const firstGifFrame = async (gif: Blob) => {
  const decoder = new ImageDecoder({ data: await gif.arrayBuffer(), type: 'image/gif' })
  try {
    const { image } = await decoder.decode({ frameIndex: 0 })
    const canvas = document.createElement('canvas'); canvas.width = image.displayWidth; canvas.height = image.displayHeight
    canvas.getContext('2d')!.drawImage(image, 0, 0); image.close()
    return await new Promise<string>(resolve => canvas.toBlob(b => b ? blobToData(b).then(resolve) : resolve(''), 'image/png'))
  } finally { decoder.close() }
}

/** Rasterises one card side with the given portrait (a data URL, or null for none) onto a canvas.
 * Every image is swapped to a data URL: the portrait on the front, each moodboard image for its own
 * tile (marked data-moodboard), so a card with mixed media never shows the wrong picture. */
async function drawSide(context: CanvasRenderingContext2D, svg: SVGSVGElement, portrait: string | null, moodData: (string | null)[] | null, x: number, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height))
  const moodImages = Array.from(clone.querySelectorAll('image[data-moodboard]'))
  if (moodData) moodImages.forEach((image, i) => { if (moodData[i]) image.setAttribute('href', moodData[i]!); else image.remove() })
  for (const image of Array.from(clone.querySelectorAll('image')).filter(image => !image.hasAttribute('data-moodboard'))) { if (portrait) image.setAttribute('href', portrait); else image.remove() }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
  try { context.drawImage(await loadImage(url), x, 0, width, height) } finally { URL.revokeObjectURL(url) }
}

/** Fetches moodboard URLs and returns a data URL for each (GIFs reduced to their first frame). */
const moodDataFor = async (urls: string[]) => Promise.all(urls.map(async href => { const blob = await (await fetch(href)).blob(); return blob.type === 'image/gif' && 'ImageDecoder' in window ? await firstGifFrame(blob) : blobToData(blob) }))

function save(blob: Blob, name: string, ext: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character') + '-puffin-card.' + ext; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Downloads the canonical front and character-details back side by side. The moodboard is a third,
 * on-screen face only; it must never replace the printable back after a user flips their card.
 * Returns which format was saved. */
export async function downloadCard(cardElement: Element, name: string): Promise<'gif' | 'png' | 'png-no-gif-support'> {
  const svgs = Array.from(cardElement.querySelectorAll<SVGSVGElement>('.tcard-face > svg'))
  if (svgs.length < 2) throw new Error('Could not prepare the card')
  const front = svgs.find(svg => svg.dataset.side === 'front'), back = svgs.find(svg => svg.dataset.side === 'back')
  if (!front || !back) throw new Error('Could not prepare the card')
  const portraitHref = front.querySelector('image:not([data-moodboard])')?.getAttribute('href')
  const portrait = portraitHref ? await fetch(portraitHref).then(r => r.ok ? r.blob() : null) : null
  const isGif = portrait?.type === 'image/gif'
  if (isGif && 'ImageDecoder' in window) { save(await animatedCard([front, back], [], portrait!), name, 'gif'); return 'gif' }
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the card')
  const data = portrait ? await blobToData(portrait) : null
  const panels = [front, back]
  const SIDE = 1280, GAP = 80
  canvas.width = panels.length * SIDE + (panels.length - 1) * GAP; canvas.height = 1720
  for (const [i, svg] of panels.entries()) await drawSide(context, svg, svg === front ? data : null, null, i * (SIDE + GAP), SIDE, 1720)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export the card')
  save(blob, name, 'png'); return isGif ? 'png-no-gif-support' : 'png'
}

/** Renders the card front+back side by side as a 1320×860 PNG Blob (static, first frame only). */
export async function cardPreviewBlob(cardElement: Element): Promise<Blob> {
  const svgs = Array.from(cardElement.querySelectorAll<SVGSVGElement>('.tcard-face > svg'))
  if (svgs.length < 2) throw new Error('Could not prepare the card')
  const front = svgs.find(svg => svg.dataset.side === 'front'), back = svgs.find(svg => svg.dataset.side === 'back')
  if (!front || !back) throw new Error('Could not prepare the card')
  const portraitHref = front.querySelector('image:not([data-moodboard])')?.getAttribute('href')
  const portrait = portraitHref ? await fetch(portraitHref).then(r => r.ok ? r.blob() : null) : null
  const data = portrait ? (portrait.type === 'image/gif' && 'ImageDecoder' in window ? await firstGifFrame(portrait) : await blobToData(portrait)) : null
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the card')
  canvas.width = 1320; canvas.height = 860
  await drawSide(context, front, data, null, 0, 640, 860)
  await drawSide(context, back, null, null, 680, 640, 860)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export the card')
  return blob
}

// ponytail: at most 60 frames (longer GIFs are sampled, delays summed) so the file stays a shareable size.
const MAX_FRAMES = 60

/** Frame 0 is the whole card (one panel per side, portrait at its first frame). Later frames repaint
 * only pixels that changed since the previous frame (the rest is transparent and kept from before,
 * dispose = 1), so only the portrait area costs bytes. */
async function animatedCard(svgs: SVGSVGElement[], moodUrls: string[], gif: Blob) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const moodData = moodUrls.length ? await moodDataFor(moodUrls) : null
  const decoder = new ImageDecoder({ data: await gif.arrayBuffer(), type: 'image/gif' })
  await decoder.tracks.ready
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1, step = Math.ceil(count / MAX_FRAMES)
  const SIDE = 640, H = 860, GAP = svgs.length === 3 ? 30 : 40, W = svgs.length * SIDE + (svgs.length - 1) * GAP
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })
  const still = document.createElement('canvas'), stillContext = still.getContext('2d')
  if (!context || !stillContext) throw new Error('Could not prepare the card')
  canvas.width = W; canvas.height = H
  const encoder = GIFEncoder()
  let previous: Uint8ClampedArray | null = null
  try {
    for (let start = 0; start < count; start += step) {
      let delay = 0, frameData = ''
      for (let i = start; i < Math.min(count, start + step); i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        delay += (image.duration ?? 100_000) / 1000
        if (i === start) { still.width = image.displayWidth; still.height = image.displayHeight; stillContext.drawImage(image, 0, 0); frameData = still.toDataURL('image/png') }
        image.close()
      }
      // Frame 0 paints every panel; later frames only the portrait side (back and mood never change).
      await drawSide(context, svgs[0], frameData, null, 0, SIDE, H)
      if (!previous) for (const [i, svg] of svgs.entries()) { if (i === 0) continue; await drawSide(context, svg, null, svg.dataset.side === 'mood' ? moodData : null, i * (SIDE + GAP), SIDE, H) }
      const rgba = context.getImageData(0, 0, W, H).data
      // Everything not repainted this frame stays transparent (dispose = 1 keeps the pixels from before).
      const changed: number[] = []
      for (let p = 0; p < rgba.length; p += 4) if (previous ? rgba[p] !== previous[p] || rgba[p + 1] !== previous[p + 1] || rgba[p + 2] !== previous[p + 2] : rgba[p + 3] >= 128) changed.push(p)
      const only = new Uint8ClampedArray(Math.max(1, changed.length) * 4)
      changed.forEach((p, k) => only.set(rgba.subarray(p, p + 4), k * 4))
      const palette = quantize(only, 255); palette.push([0, 0, 0])
      const transparentIndex = palette.length - 1, index = new Uint8Array(W * H).fill(transparentIndex), mapped = applyPalette(only, palette)
      changed.forEach((p, k) => { index[p / 4] = mapped[k] })
      encoder.writeFrame(index, W, H, { palette, delay: Math.max(20, delay), dispose: 1, transparent: true, transparentIndex, ...(previous ? {} : { repeat: 0 }) })
      previous = rgba
    }
  } finally { decoder.close() }
  encoder.finish()
  return new Blob([encoder.bytes()], { type: 'image/gif' })
}
