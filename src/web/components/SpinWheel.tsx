import { useState } from 'react'

export type SpinItem = { id: string; label: string; href?: string }

/** "Can't decide what to reply to first?" Picks one item at random, spins the chart beside it
 * (instantly under reduced motion), then scrolls to and highlights the chosen card, which carries
 * data-pick-id. Client-only: nothing is saved. */
export default function SpinWheel({ items, empty }: { items: SpinItem[]; empty: string }) {
  const [pick, setPick] = useState<SpinItem | null>(null)
  const [spinning, setSpinning] = useState(false)
  function spin() {
    if (!items.length || spinning) return
    const choice = items[Math.floor(Math.random() * items.length)]
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setSpinning(!reduce)
    window.setTimeout(() => {
      setSpinning(false)
      setPick(choice)
      const card = document.querySelector<HTMLElement>(`[data-pick-id="${CSS.escape(choice.id)}"]`)
      card?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
      card?.classList.add('is-picked')
      window.setTimeout(() => card?.classList.remove('is-picked'), 2600)
    }, reduce ? 0 : 750)
  }
  return <div className="spin-wheel" data-spinning={spinning || undefined}>
    <button type="button" className="secondary-button" title="Can’t decide where to start? Let Puffin pick one." onClick={spin} disabled={!items.length || spinning}>{spinning ? 'Spinning…' : pick ? 'Spin again' : 'Spin the wheel'}</button>
    <p aria-live="polite">{!items.length ? empty : pick ? <>Reply to this one? <strong>{pick.label}</strong>{pick.href && <> · <a href={pick.href}>Open</a></>}</> : null}</p>
  </div>
}
