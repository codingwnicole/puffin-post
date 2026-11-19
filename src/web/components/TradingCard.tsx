import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// A two-sided collectible card for a character, drawn as plain SVG so the same markup is shown
// on the page and rasterised for the PNG download (no foreignObject, no dependencies).
// Palettes adapted from the Character Card Studio brief; per-theme ornament art was left out.

export type CardProfile = { theme: ThemeId; nickname: string; age: string; birthdate: string; quote: string; song: string; artist: string; favoriteColor: string; facts: string[]; likes: string; dislikes: string; notes: string }
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

export const emptyCard = (): CardProfile => ({ theme: 'holo', nickname: '', age: '', birthdate: '', quote: '', song: '', artist: '', favoriteColor: '#b07a9e', facts: ['', '', '', '', ''], likes: '', dislikes: '', notes: '' })

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
    <path d="M320 864l5 11 11 5-11 5-5 11-5-11-11-5 11-5z" transform="translate(0 -14) scale(1)" fill={t.accent} />
    {side === 'front' ? <>
      <g clipPath={`url(#${id('portrait')})`}>
        <rect x={40} y={70} width={560} height={330} fill={`url(#${id('panel')})`} />
        {portrait ? <image href={portrait} x={40} y={70} width={560} height={330} preserveAspectRatio="xMidYMid slice" /> : <text x={320} y={262} textAnchor="middle" fill={t.accent} fontFamily={t.font} fontSize={110}>{initials}</text>}
      </g>
      <rect x={40} y={70} width={560} height={330} rx={Math.min(t.corner * 2, 40)} fill="none" stroke={`url(#${id('foil')})`} strokeWidth={3} />
      {box(420, 70, { stroke: `url(#${id('foil')})`, strokeOpacity: 1, strokeWidth: 2 })}
      <path d="M72 442l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill={t.accent} />
      <text x={104} y={468} {...body} fontSize={name.length > 18 ? 30 : 40}>{name.slice(0, 26)}</text>
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
      {[0, 1, 2, 3, 4].map(i => <g key={i}><path d={`M66 ${343 + i * 38}l3 7 7 3-7 3-3 7-3-7-7-3 7-3z`} fill={t.accent} /><text x={88} y={358 + i * 38} {...body} fontSize={17}>{(profile.facts[i] || '—').slice(0, 52)}</text></g>)}
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

/** Downloads front and back side by side as one 2640 × 1800 PNG. The portrait is inlined as a data URL first,
 * because an SVG drawn into a canvas may not load outside images. */
export async function downloadCard(cardElement: Element, name: string) {
  const svgs = Array.from(cardElement.querySelectorAll<SVGSVGElement>('.tcard-face > svg'))
  const toData = async (href: string) => { const blob = await fetch(href).then(r => r.ok ? r.blob() : null); return blob ? await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) }) : null }
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context || svgs.length !== 2) throw new Error('Could not prepare the card')
  canvas.width = 2640; canvas.height = 1800
  for (const [index, svg] of svgs.entries()) {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', '1280'); clone.setAttribute('height', '1800')
    for (const image of Array.from(clone.querySelectorAll('image'))) { const data = await toData(image.getAttribute('href') ?? ''); if (data) image.setAttribute('href', data); else image.remove() }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
    try { const img = new Image(); await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not draw the card')); img.src = url }); context.drawImage(img, index * 1360, 0, 1280, 1800) } finally { URL.revokeObjectURL(url) }
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export the card')
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character') + '-puffin-card.png'; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
