import { useRef, useState } from 'react'

export type SpinItem = { id: string; label: string; href?: string }

const SEGMENT_TINTS = ['var(--turn-t)', 'var(--starter-t)', 'var(--wait-t)', 'var(--peach-t)', 'var(--lav-t)', 'var(--dorm-t)']
const SPIN_MS = 3600

/** "Can't decide what to reply to first?" Picks one item at random and spins a small wheel of the candidates
 * (a single CSS transition with a long ease-out that overshoots slightly and settles; instant under reduced motion),
 * then scrolls to and highlights the chosen card, which carries data-pick-id. Client-only: nothing is saved. */
export default function SpinWheel({ items, empty }: { items: SpinItem[]; empty: string }) {
  const [pick, setPick] = useState<SpinItem | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const done = useRef<number | undefined>(undefined)
  const segment = 360 / Math.max(items.length, 1)

  function reveal(choice: SpinItem, reduce: boolean) {
    setSpinning(false)
    setPick(choice)
    // Cross-list highlight: the chosen card lives in the page, not in this component (allowed direct DOM, see AGENTS.md).
    const card = document.querySelector<HTMLElement>(`[data-pick-id="${CSS.escape(choice.id)}"]`)
    card?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    card?.classList.add('is-picked')
    window.setTimeout(() => card?.classList.remove('is-picked'), 2600)
  }

  function spin() {
    if (!items.length || spinning) return
    const index = Math.floor(Math.random() * items.length)
    const choice = items[index]
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    // Land the middle of the chosen segment under the pointer, five to seven full turns past where the wheel stands.
    const settled = ((rotation % 360) + 360) % 360
    const turns = 5 + Math.floor(Math.random() * 3)
    setRotation(rotation - settled + turns * 360 + (360 - (index + 0.5) * segment))
    window.clearTimeout(done.current)
    if (reduce) { reveal(choice, true); return }
    setSpinning(true)
    setPick(null)
    done.current = window.setTimeout(() => reveal(choice, false), SPIN_MS + 60)
  }

  const winner = pick ? items.findIndex(item => item.id === pick.id) : -1
  return <div className="spin-wheel" data-spinning={spinning || undefined}>
    {items.length > 0 && <div className={`spin-dial${winner >= 0 ? ' has-winner' : ''}`} aria-hidden="true">
      <svg className="spin-pointer" viewBox="0 0 24 30"><path d="M12 30 1 6a11 11 0 0 1 22 0Z" /></svg>
      <svg className="spin-face" viewBox="0 0 100 100" style={{ transform: `rotate(${rotation}deg)`, transitionDuration: spinning ? `${SPIN_MS}ms` : '0ms' }}>
        <circle cx="50" cy="50" r="49" className="spin-rim" />
        {items.map((item, i) => {
          if (items.length === 1) return <circle key={item.id} cx="50" cy="50" r="46" style={{ fill: SEGMENT_TINTS[0] }} />
          const a0 = (i * segment - 90) * Math.PI / 180, a1 = ((i + 1) * segment - 90) * Math.PI / 180
          const d = `M50 50 L${(50 + 46 * Math.cos(a0)).toFixed(2)} ${(50 + 46 * Math.sin(a0)).toFixed(2)} A46 46 0 ${segment > 180 ? 1 : 0} 1 ${(50 + 46 * Math.cos(a1)).toFixed(2)} ${(50 + 46 * Math.sin(a1)).toFixed(2)}Z`
          return <path key={item.id} d={d} className={i === winner ? 'is-win' : undefined} style={{ fill: SEGMENT_TINTS[i % SEGMENT_TINTS.length] }} />
        })}
        <circle cx="50" cy="50" r="10" className="spin-hub" />
      </svg>
    </div>}
    <div className="spin-controls">
      <button type="button" className="secondary-button" title="Can’t decide where to start? Let Thread Buddy pick one." onClick={spin} disabled={!items.length || spinning}>{spinning ? 'Spinning…' : pick ? 'Spin again' : 'Spin the wheel'}</button>
      <p aria-live="polite">{!items.length ? empty : pick ? <>Reply to this one? <strong>{pick.label}</strong>{pick.href && <> · <a href={pick.href}>Open</a></>}</> : null}</p>
    </div>
  </div>
}
