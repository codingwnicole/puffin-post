import { useEffect, useId, useRef, useState } from 'react'
import { useNativeDialog } from '../lib/dialog'
import { spinLanding } from '../lib/spin-wheel'

export type SpinItem = { id: string; label: string; context?: string; href?: string; actionLabel?: string; external?: boolean }
const TINTS = ['var(--highlight)', 'var(--peach-t)', 'var(--lav-t)', 'var(--surface-muted)']
const SPIN_MS = 3600

/** Shared client-only picker. Freeze the candidates so the drawing and winning item stay synchronized. */
export default function SpinWheel({ items, empty, title = 'Pick your next reply', onChoose }: {
  items: SpinItem[]; empty: string; title?: string; onChoose?: (item: SpinItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<SpinItem | null>(null)
  const [candidates, setCandidates] = useState(items)
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [copied, setCopied] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const done = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Synchronous lock covers clicks arriving before React renders the disabled state.
  const pending = useRef<SpinItem | null>(null)
  const titleId = useId(), statusId = useId()
  useNativeDialog(dialogRef, open)
  useEffect(() => () => { clearTimeout(done.current); pending.current = null }, [])

  function reveal() {
    const choice = pending.current
    if (!choice) return
    clearTimeout(done.current)
    pending.current = null
    setSpinning(false)
    setChosen(choice)
  }
  function close() {
    clearTimeout(done.current)
    if (pending.current) { setChosen(null); setRotation(0) }
    pending.current = null
    setSpinning(false)
    setOpen(false)
  }
  function spin() {
    if (!items.length || pending.current) return
    const index = Math.floor(Math.random() * items.length)
    pending.current = items[index]
    setCandidates([...items])
    setChosen(null)
    setCopied('')
    setRotation(current => spinLanding(current, index, items.length))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || items.length === 1) { reveal(); return }
    setSpinning(true)
    // transitionend normally completes; timeout covers background tabs or interrupted transitions.
    done.current = setTimeout(reveal, SPIN_MS + 100)
  }
  useEffect(() => {
    if (!spinning) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const settle = () => { if (media.matches) reveal() }
    media.addEventListener('change', settle)
    return () => media.removeEventListener('change', settle)
  }, [spinning])

  const pick = chosen && items.find(item => item.id === chosen.id)
  const segments = spinning || chosen ? candidates : items
  const segment = 360 / Math.max(segments.length, 1)
  const winner = pick ? segments.findIndex(item => item.id === pick.id) : -1

  return <div className="spin-wheel">
    <button ref={openerRef} type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => { setCopied(''); setOpen(true) }} disabled={!items.length}>Spin the wheel</button>
    {!items.length && <p className="field-help">{empty}</p>}
    <dialog ref={dialogRef} className="wheel-dialog" aria-labelledby={titleId} aria-describedby={statusId}
      onCancel={event => { event.preventDefault(); close() }} onClose={() => { if (!dialogRef.current?.open) close() }}>
      <header className="wheel-heading"><h2 id={titleId}>{title}</h2><button type="button" className="secondary-button" onClick={close}>Close</button></header>
      <div className="wheel-layout">
        <div className={`spin-dial${winner >= 0 ? ' has-winner' : ''}`} data-spinning={spinning || undefined} aria-hidden="true">
          <svg className="spin-pointer" viewBox="0 0 24 30"><path d="M12 30 1 6a11 11 0 0 1 22 0Z" /></svg>
          <svg className="spin-face" viewBox="0 0 100 100" data-rotation={rotation}
            style={{ transform: `rotate(${rotation}deg)`, transitionDuration: spinning ? 'var(--motion-wheel)' : '0ms' }}
            onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform') reveal() }}>
            <circle cx="50" cy="50" r="49" className="spin-rim" />
            {segments.map((item, i) => {
              const middle = ((i + .5) * segment - 90) * Math.PI / 180
              const a0 = (i * segment - 90) * Math.PI / 180, a1 = ((i + 1) * segment - 90) * Math.PI / 180
              const d = `M50 50 L${50 + 46 * Math.cos(a0)} ${50 + 46 * Math.sin(a0)} A46 46 0 ${segment > 180 ? 1 : 0} 1 ${50 + 46 * Math.cos(a1)} ${50 + 46 * Math.sin(a1)}Z`
              return <g key={item.id}>
                {segments.length === 1 ? <circle cx="50" cy="50" r="46" style={{ fill: TINTS[0] }} />
                  : <path d={d} className={i === winner ? 'is-win' : undefined} style={{ fill: TINTS[i % TINTS.length] }} />}
                {segments.length <= 16 && <text x={50 + 33 * Math.cos(middle)} y={50 + 33 * Math.sin(middle)} textAnchor="middle" dominantBaseline="central" style={{ transform: `rotate(${-rotation}deg)`, transitionDuration: spinning ? 'var(--motion-wheel)' : '0ms' }}>{i + 1}</text>}
              </g>
            })}
            <circle cx="50" cy="50" r="10" className="spin-hub" />
          </svg>
        </div>
        <div className="wheel-outcome">
          <div className="wheel-result" id={statusId} role="status" aria-live="polite" aria-atomic="true">
            {spinning ? <p>Choosing from {segments.length} items…</p> : pick ? <><p>Your pick{winner >= 0 ? ` · ${winner + 1}` : ''}</p><h3>{pick.label}</h3>{pick.context && <p>{pick.context}</p>}</>
              : <p>{!items.length ? empty : chosen ? 'That item is no longer available. Spin again for a new pick.' : `${items.length} ${items.length === 1 ? 'item' : 'items'} ready. Give the wheel a spin.`}</p>}
          </div>
          <div className="wheel-actions">
            {!spinning && pick && (pick.href ? <a className="button" href={pick.href} target={pick.external ? '_blank' : undefined} rel={pick.external ? 'noopener noreferrer' : undefined} onClick={() => { if (!pick.external) close() }}>{pick.actionLabel ?? 'Open'}</a>
              : onChoose && <button type="button" onClick={() => { close(); onChoose(pick) }}>{pick.actionLabel ?? 'Open'}</button>)}
            <button type="button" className={pick ? 'secondary-button' : undefined} disabled={spinning || !items.length} onClick={spin}>{spinning ? 'Spinning…' : chosen ? 'Spin Again' : 'Spin'}</button>
          </div>
          <div className="wheel-link-help">{!spinning && pick?.external && pick.href && <>Opens in a new tab. <button type="button" className="text-button" onClick={() => {
            if (!navigator.clipboard?.writeText) { setCopied('Use the link menu to copy the Tumblr address.'); return }
            void navigator.clipboard.writeText(pick.href!).then(() => setCopied('Link copied.'), () => setCopied('Use the link menu to copy the Tumblr address.'))
          }}>Copy link</button><span role="status">{copied}</span></>}</div>
          <p className="field-help">{spinning ? 'Closing cancels this spin.' : 'You can spin again or close whenever you like.'}</p>
        </div>
      </div>
      <details className="wheel-candidates"><summary>On the wheel ({segments.length})</summary><ol>{segments.map(item => <li key={item.id}>{item.label}</li>)}</ol></details>
    </dialog>
  </div>
}
