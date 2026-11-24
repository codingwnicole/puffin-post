import { useEffect, useState } from 'react'
import { staleGet } from '../lib/api'
import { clock } from '../components/DeskRail'
import { FOCUS_LENGTHS, breakMinutes, isPaused, pause, phaseLength, resume, setLength, start, stop, timeLeft, update, useFocus } from '../lib/focus'

type Scene = { starterId: string; title: string; characterName: string; status: string }

const RADIUS = 150, CIRCUMFERENCE = 2 * Math.PI * RADIUS
const PETALS = Array.from({ length: 8 }, (_, i) => i * 45)
const LEAVES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i + 0.5) / 12 * Math.PI * 2 - Math.PI / 2
  return { x: 170 + 168 * Math.cos(angle), y: 170 + 168 * Math.sin(angle), r: i * 30 + 15 }
})


export default function FocusPage() {
  const [focus, now] = useFocus()
  const [scenes, setScenes] = useState<Scene[]>([])
  useEffect(() => {
    let active = true
    staleGet<{ branches: Scene[] }>('/inbox').then(inbox => {
      if (!active) return
      // one entry per thread, your-turn scenes first
      const seen = new Set<string>(), list: Scene[] = []
      for (const branch of [...inbox.branches].sort((a, b) => Number(b.status === 'your_turn') - Number(a.status === 'your_turn'))) {
        if (!seen.has(branch.starterId)) { seen.add(branch.starterId); list.push(branch) }
      }
      setScenes(list)
    }).catch(() => { /* the picker falls back to free writing */ })
    return () => { active = false }
  }, [])

  const left = timeLeft(focus, now), paused = isPaused(focus), idle = focus.phase === 'idle'
  const progress = idle ? 0 : 1 - left / phaseLength(focus)
  const title = focus.link?.title ?? 'Free writing'
  const label = idle ? 'Ready' : focus.phase === 'break' ? (paused ? 'Break paused' : 'Break') : (paused ? 'Paused' : 'Writing')
  const blooming = focus.justFinished && focus.phase === 'break'

  return <section className="focus-page" aria-labelledby="focus-title">
    <a className="text-button focus-back" href="#tools">Back to writing tools</a>
    <h1 id="focus-title" className="page-heading">Focus</h1>
    <p className="page-description">Focus cycles use the solo sprint timer, with a break after each session: 5 minutes, or 15 after every fourth. Pick the scene you're writing for. The timer keeps running when you leave this page, and everything stays in this browser.</p>
    <div className="focus-layout">
      <div className="focus-timer">
        <div className={`focus-ring${blooming ? ' is-blooming' : ''}${focus.phase === 'break' ? ' is-break' : ''}`}>
          <svg viewBox="0 0 340 340" aria-hidden="true">
            {PETALS.map(angle => <g key={angle} transform={`rotate(${angle} 170 170)`}><ellipse className="focus-petal" cx="170" cy="14" rx="10" ry="18" style={{ '--i': angle / 45 } as React.CSSProperties} /></g>)}
            <circle className="focus-track" cx="170" cy="170" r={RADIUS} />
            <circle className="focus-progress" cx="170" cy="170" r={RADIUS} strokeDasharray={CIRCUMFERENCE.toFixed(1)} strokeDashoffset={(CIRCUMFERENCE * (1 - progress)).toFixed(1)} transform="rotate(-90 170 170)" />
            {LEAVES.map(leaf => <ellipse key={leaf.r} className="focus-leaf" cx={leaf.x.toFixed(1)} cy={leaf.y.toFixed(1)} rx="3.5" ry="8" transform={`rotate(${leaf.r} ${leaf.x.toFixed(1)} ${leaf.y.toFixed(1)})`} />)}
          </svg>
          <div className="focus-face">
            <span className="focus-clock" role="timer" aria-label={`${label}, ${clock(left)} left`}>{clock(left)}</span>
            <span className="focus-label">{label} · {focus.phase === 'break' ? `${breakMinutes(focus.completed)} min` : title}</span>
          </div>
        </div>
        <div className="focus-lengths" role="group" aria-label="Session length">
          {FOCUS_LENGTHS.map(minutes => <button key={minutes} type="button" className="secondary-button" aria-pressed={focus.lengthMin === minutes} disabled={!idle} onClick={() => update(s => setLength(s, minutes))}>{minutes} min</button>)}
        </div>
        <div className="actions focus-controls">
          {idle && <button type="button" onClick={() => update(s => start(s, Date.now()))}>Start focus</button>}
          {!idle && (paused
            ? <button type="button" onClick={() => update(s => resume(s, Date.now()))}>Resume</button>
            : <button type="button" className="secondary-button" onClick={() => update(s => pause(s, Date.now()))}>Pause</button>)}
          {!idle && <button type="button" className="secondary-button" onClick={() => update(stop)}>{focus.phase === 'break' ? 'Skip break' : 'Stop'}</button>}
        </div>
        <p role="status" className="focus-status">{blooming ? `Session done: ${focus.history[0]?.minutes ?? focus.lengthMin} minutes on ${focus.history[0]?.title ?? title}. Take ${breakMinutes(focus.completed)}.` : ''}</p>
        <ol className="focus-cycle" aria-label={`${focus.completed} of 4 sessions done in this cycle`}>
          {[1, 2, 3, 4].map(n => <li key={n} data-done={n <= focus.completed || undefined} />)}
        </ol>
      </div>
      <div className="focus-side">
        <label className="focus-scene">Writing for
          <select value={focus.link?.id ?? ''} disabled={!idle} onChange={event => {
            const scene = scenes.find(item => item.starterId === event.target.value)
            update(s => ({ ...s, link: scene ? { id: scene.starterId, title: scene.title } : null }))
          }}>
            <option value="">Free writing</option>
            {focus.link && !scenes.some(scene => scene.starterId === focus.link!.id) && <option value={focus.link.id}>{focus.link.title}</option>}
            {scenes.map(scene => <option key={scene.starterId} value={scene.starterId}>{scene.title} ({scene.characterName}){scene.status === 'your_turn' ? ', your turn' : ''}</option>)}
          </select>
        </label>
        {focus.link && <a className="text-button" href={`#starter/${focus.link.id}`}>Open this scene</a>}
        <section className="focus-history" aria-labelledby="focus-history-title">
          <h2 id="focus-history-title">Recent sessions</h2>
          {focus.history.length === 0
            ? <p className="field-help">Finished sessions show here. Stopped ones don't count.</p>
            : <ul>{focus.history.map(session => <li key={session.endedAt}><span><strong>{session.title}</strong><small>{new Date(session.endedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small></span><span>{session.minutes} min</span></li>)}</ul>}
        </section>
        <a className="text-button" href="#tools/sprints">Writing several replies? Use a writing sprint</a>
      </div>
    </div>
  </section>
}
