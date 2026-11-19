import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { CARD_SYMBOLS, SYMBOL_FONT, type CardSymbol } from '../../shared/card-symbols'

// A two-sided collectible card for a character, drawn as plain SVG so the same markup is shown
// on the page and rasterised for the PNG download (no foreignObject, no dependencies).
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

function Side({ side, name, profile, stats, portrait, uid }: { side: 'front' | 'back'; name: string; profile: CardProfile; stats: CardStats; portrait: string | null; uid: string }) {
  const t: Theme = THEMES[profile.theme] ?? THEMES.holo
  const id = (key: string) => `${uid}-${side}-${key}`
  const label = { fill: t.sub, fontFamily: t.sans, fontSize: 11, letterSpacing: 3 } as const
  const body = { fill: t.ink, fontFamily: t.font, fontStyle: 'italic' as const }
  const box = (y: number, h: number, extra?: object) => <rect x={40} y={y} width={560} height={h} rx={Math.min(t.corner, 14)} fill={`url(#${id('panel')})`} stroke={t.stroke} strokeOpacity={.7} {...extra} />
  // The writer's chosen symbol (none by default) sits beside the name, on the fun-fact bullets and in the footer.
  const glyph: string = CARD_SYMBOLS[profile.symbol ?? 'none']?.glyph ?? ''
  const symbolText = (x: number, y: number, size: number) => <text x={x} y={y} textAnchor="middle" fill={t.accent} fontFamily={SYMBOL_FONT} fontSize={size} data-symbol>{glyph}</text>
  const initials = name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
  return <svg viewBox="0 0 640 900" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${name}'s card, ${side}`} data-side={side}>
    <defs>
      <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">{t.bg.map((c, i) => <stop key={i} offset={i / 2} stopColor={c} />)}</linearGradient>
      <linearGradient id={id('foil')} x1="0" y1="0" x2="1" y2="1">{t.foil.map((c, i) => <stop key={i} offset={i / (t.foil.length - 1)} stopColor={c} />)}</linearGradient>
      <linearGradient id={id('panel')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={t.panel[0]} stopOpacity={.92} /><stop offset="1" stopColor={t.panel[1]} stopOpacity={.92} /></linearGradient>
      <clipPath id={id('portrait')}><rect x={40} y={70} width={560} height={330} rx={Math.min(t.corner * 2, 40)} /></clipPath>
    </defs>
    <rect x={6} y={6} width={628} height={888} rx={t.corner + 14} fill={`url(#${id('bg')})`} stroke={`url(#${id('foil')})`} strokeWidth={10} />
    <rect x={20} y={20} width={600} height={860} rx={t.corner + 6} fill="none" stroke={t.stroke} strokeOpacity={.55} />
    <text x={44} y={50} {...label}>{side === 'front' ? 'CHARACTER CARD ///' : 'CHARACTER DETAILS ///'}</text>
    <text x={596} y={50} textAnchor="end" {...label}>PUFFIN POST</text>
    {glyph && symbolText(320, 868, 18)}
    {side === 'front' ? <>
      <g clipPath={`url(#${id('portrait')})`}>
        <rect x={40} y={70} width={560} height={330} fill={`url(#${id('panel')})`} />
        {portrait ? <image href={portrait} x={40} y={70} width={560} height={330} preserveAspectRatio="xMidYMid slice" /> : <text x={320} y={262} textAnchor="middle" fill={t.accent} fontFamily={t.font} fontSize={110}>{initials}</text>}
      </g>
      <rect x={40} y={70} width={560} height={330} rx={Math.min(t.corner * 2, 40)} fill="none" stroke={`url(#${id('foil')})`} strokeWidth={3} />
      {box(420, 70, { stroke: `url(#${id('foil')})`, strokeOpacity: 1, strokeWidth: 2 })}
      {glyph && symbolText(74, 468, 30)}
      <text x={glyph ? 104 : 62} y={468} {...body} fontSize={name.length > 18 ? 30 : 40}>{name.slice(0, 26)}</text>
      {box(506, 44)}<text x={60} y={533} {...label}>NICKNAME / ALIAS</text><text x={250} y={534} {...body} fontSize={17}>{profile.nickname || '—'}</text>
      {box(562, 44)}<text x={60} y={589} {...label}>AGE</text><text x={120} y={590} {...body} fontSize={17}>{profile.age || '—'}</text><text x={330} y={589} {...label}>BIRTHDATE</text><text x={440} y={590} {...body} fontSize={17}>{profile.birthdate || '—'}</text>
      {box(618, 100)}<text x={56} y={652} fill={t.accent} fontFamily={t.font} fontSize={34}>“</text>
      {wrap(profile.quote || 'A line that captures them.', 46, 3).map((line, i) => <text key={i} x={320} y={652 + i * 24} textAnchor="middle" {...body} fontSize={18}>{line}</text>)}
      {box(730, 56)}<circle cx={70} cy={758} r={15} fill="none" stroke={t.ink} strokeWidth={2} /><path d="M65 750l13 8-13 8z" fill={t.ink} />
      <text x={98} y={752} {...label}>THEME SONG</text><text x={98} y={774} {...body} fontSize={16}>{(profile.song || 'Song title') + (profile.artist ? ' — ' + profile.artist : '')}</text>
      {Array.from({ length: 22 }, (_, i) => { const h = 6 + ((i * 7) % 11) * 2; return <rect key={i} x={460 + i * 6} y={758 - h / 2} width={3} height={h} fill={t.sub} opacity={.8} /> })}
      {box(798, 44)}<text x={60} y={825} {...label}>FAVORITE COLOR</text><rect x={430} y={808} width={150} height={24} rx={6} fill={profile.favoriteColor} stroke={t.ink} strokeOpacity={.5} />
    </> : <>
      {box(70, 200)}<text x={60} y={100} {...label}>THREAD STATS</text>
      {([['THREADS', stats.total], ['YOUR TURN', stats.mine], ['THEIR TURN', stats.theirs]] as const).map(([what, value], i) => <g key={what}><text x={133 + i * 187} y={185} textAnchor="middle" fill={t.ink} fontFamily={t.font} fontSize={64}>{value}</text><text x={133 + i * 187} y={215} textAnchor="middle" {...label}>{what}</text></g>)}
      <text x={320} y={252} textAnchor="middle" {...body} fontSize={15}>{wrap(stats.rps.length ? 'Writes in ' + stats.rps.join(' / ') : 'Not in an RP section yet', 60, 1)[0]}</text>
      {box(286, 250)}<text x={60} y={316} {...label}>FUN FACTS</text>
      {[0, 1, 2, 3, 4].map(i => <g key={i}>{glyph ? symbolText(66, 358 + i * 38, 16) : <circle cx={66} cy={352 + i * 38} r={3} fill={t.accent} />}<text x={88} y={358 + i * 38} {...body} fontSize={17}>{(profile.facts[i] || '—').slice(0, 52)}</text></g>)}
      {box(552, 120, { width: 272 })}{box(552, 120, { x: 328, width: 272 })}
      <text x={60} y={580} {...label}>LIKES</text><text x={348} y={580} {...label}>DISLIKES</text>
      {wrap(profile.likes || '—', 26, 3).map((line, i) => <text key={'l' + i} x={60} y={608 + i * 22} {...body} fontSize={16}>{line}</text>)}
      {wrap(profile.dislikes || '—', 26, 3).map((line, i) => <text key={'d' + i} x={348} y={608 + i * 22} {...body} fontSize={16}>{line}</text>)}
      {box(688, 150)}<text x={60} y={718} {...label}>MISC. / NOTES</text>
      {wrap(profile.notes || '—', 54, 4).map((line, i) => <text key={i} x={60} y={748 + i * 24} {...body} fontSize={17}>{line}</text>)}
    </>}
  </svg>
}

/** Flip on click / Enter / Space; tilt and foil shine follow the pointer (off under reduced motion via CSS). */
export default function TradingCard({ name, profile, stats, portrait }: { name: string; profile: CardProfile; stats: CardStats; portrait: string | null }) {
  const [flipped, setFlipped] = useState(false)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height
    event.currentTarget.style.setProperty('--rx', `${(0.5 - y) * 14}deg`); event.currentTarget.style.setProperty('--ry', `${(x - 0.5) * 18}deg`)
    event.currentTarget.style.setProperty('--mx', `${x * 100}%`); event.currentTarget.style.setProperty('--my', `${y * 100}%`)
  }
  const leave = (event: PointerEvent<HTMLDivElement>) => { for (const key of ['--rx', '--ry', '--mx', '--my']) event.currentTarget.style.removeProperty(key) }
  return <div className="tcard" data-theme-id={profile.theme} data-flipped={flipped || undefined} onPointerMove={move} onPointerLeave={leave} style={{ '--card-glow': THEMES[profile.theme]?.accent } as CSSProperties}>
    <button type="button" className="tcard-inner" aria-pressed={flipped} aria-label={`Flip ${name}'s card to the ${flipped ? 'front' : 'back'}`} onClick={() => setFlipped(!flipped)}>
      <span className="tcard-flip">
      <span className="tcard-face tcard-front"><Side side="front" name={name} profile={profile} stats={stats} portrait={portrait} uid={uid} /></span>
      <span className="tcard-face tcard-back"><Side side="back" name={name} profile={profile} stats={stats} portrait={portrait} uid={uid} /></span></span>
    </button>
  </div>
}

const blobToData = (blob: Blob) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not draw the card')); img.src = url })

/** Rasterises one card side with the given portrait (a data URL, or null for none) onto a canvas. */
async function drawSide(context: CanvasRenderingContext2D, svg: SVGSVGElement, portrait: string | null, x: number, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height))
  for (const image of Array.from(clone.querySelectorAll('image'))) { if (portrait) image.setAttribute('href', portrait); else image.remove() }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
  try { context.drawImage(await loadImage(url), x, 0, width, height) } finally { URL.revokeObjectURL(url) }
}

function save(blob: Blob, name: string, ext: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character') + '-puffin-card.' + ext; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Downloads front and back side by side. A GIF portrait gives an animated 1320 × 900 GIF; anything else
 * (or a browser without ImageDecoder) gives a 2640 × 1800 PNG. Returns which one was saved. The portrait is
 * inlined as a data URL because an SVG drawn into a canvas may not load outside images. */
export async function downloadCard(cardElement: Element, name: string): Promise<'gif' | 'png' | 'png-no-gif-support'> {
  const svgs = Array.from(cardElement.querySelectorAll<SVGSVGElement>('.tcard-face > svg'))
  if (svgs.length !== 2) throw new Error('Could not prepare the card')
  const href = svgs[0].querySelector('image')?.getAttribute('href')
  const portrait = href ? await fetch(href).then(r => r.ok ? r.blob() : null) : null
  const isGif = portrait?.type === 'image/gif'
  if (isGif && 'ImageDecoder' in window) { save(await animatedCard(svgs, portrait!), name, 'gif'); return 'gif' }
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare the card')
  canvas.width = 2640; canvas.height = 1800
  const data = portrait ? await blobToData(portrait) : null
  for (const [index, svg] of svgs.entries()) await drawSide(context, svg, data, index * 1360, 1280, 1800)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export the card')
  save(blob, name, 'png'); return isGif ? 'png-no-gif-support' : 'png'
}

// ponytail: at most 60 frames (longer GIFs are sampled, delays summed) so the file stays a shareable size.
const MAX_FRAMES = 60

/** Frame 0 is the whole card. Later frames repaint only pixels that changed since the previous frame (the rest
 * is transparent and kept from before, dispose = 1), so only the portrait area costs bytes. */
async function animatedCard(svgs: SVGSVGElement[], gif: Blob) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const decoder = new ImageDecoder({ data: await gif.arrayBuffer(), type: 'image/gif' })
  await decoder.tracks.ready
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1, step = Math.ceil(count / MAX_FRAMES)
  const W = 1320, H = 900, SIDE = 640
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
      await drawSide(context, svgs[0], frameData, 0, SIDE, H)
      if (!previous) await drawSide(context, svgs[1], null, SIDE + 40, SIDE, H)
      const rgba = context.getImageData(0, 0, W, H).data
      // Frame 0 paints every visible pixel; later frames only what changed. Everything else stays transparent.
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
