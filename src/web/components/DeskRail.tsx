import { useState } from 'react'
import { parsePlaylist } from '../../shared/embeds'
import { api, clearDraftLocal, restoreDraftLocal, saveDraftLocal } from '../lib/api'
import { isPaused, pause, phaseLength, resume, start, timeLeft, update, useFocus } from '../lib/focus'
import Icon from './Icon'
import SprintStats from './SprintStats'

// The desk rail: a right-hand column on wide screens with the focus timer, a music player and a quick note.
// It lives in AppShell, so music keeps playing while you move between pages. Phones get DeskBar instead, a slim
// strip above the tab bar that shows only while a focus cycle runs. Rail state and the playlist link stay in this
// browser (puffin-post.desk); the player loads only after a click, like character playlists.

const KEY = 'puffin-post.desk'
const NOTE_DRAFT = 'desk-quick-note'
const SERVICE = { spotify: 'Spotify', youtube: 'YouTube', apple: 'Apple Music' } as const
type DeskPrefs = { open: boolean; playlist: string }

function readPrefs(): DeskPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return { open: value?.open !== false, playlist: typeof value?.playlist === 'string' ? value.playlist.slice(0, 500) : '' }
  } catch { return { open: true, playlist: '' } }
}
function writePrefs(prefs: DeskPrefs) { try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* per-browser convenience only */ } }

export function clock(ms: number) {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function useFocusSummary() {
  const [focus, now] = useFocus()
  const idle = focus.phase === 'idle', paused = isPaused(focus), left = timeLeft(focus, now)
  const label = idle ? 'Ready' : focus.phase === 'break' ? (paused ? 'Break paused' : 'Break') : (paused ? 'Paused' : 'Writing')
  const detail = focus.phase === 'break' ? 'stretch, then back to it' : focus.link?.title ?? 'Free writing'
  const toggle = () => update(s => s.phase === 'idle' ? start(s, Date.now()) : isPaused(s) ? resume(s, Date.now()) : pause(s, Date.now()))
  // "Start focus", not "Start": the rail sits beside pages that have their own Start buttons (writing sprints).
  const action = `${idle ? 'Start' : paused ? 'Resume' : 'Pause'} focus`
  return { focus, idle, left, label, detail, toggle, action, progress: idle ? 0 : 1 - left / phaseLength(focus) }
}

export default function DeskRail() {
  const [prefs, setPrefs] = useState(readPrefs)
  const save = (next: DeskPrefs) => { setPrefs(next); writePrefs(next) }
  const timer = useFocusSummary()
  const ringLength = 2 * Math.PI * 19

  return <aside className="rd-desk" data-open={prefs.open} aria-label="Your desk">
    <div className="rd-desk-head">
      <h2>Your desk</h2>
      <button type="button" className="rd-desk-toggle" aria-expanded={prefs.open} aria-label={prefs.open ? 'Collapse desk' : 'Expand desk'} onClick={() => save({ ...prefs, open: !prefs.open })}><Icon name="chevron" /></button>
    </div>
    {!prefs.open && <button type="button" className="rd-desk-mini" aria-label={`Open desk. Focus timer ${clock(timer.left)}, ${timer.label}`} onClick={() => save({ ...prefs, open: true })}>{clock(timer.left)}</button>}
    {prefs.open && <div className="rd-desk-body">
      <section className="rd-desk-module" aria-labelledby="desk-focus">
        <h3 id="desk-focus">Focus</h3>
        <div className="rd-desk-timer">
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle className="focus-track" cx="22" cy="22" r="19" /><circle className="focus-progress" cx="22" cy="22" r="19" strokeDasharray={ringLength.toFixed(1)} strokeDashoffset={(ringLength * (1 - timer.progress)).toFixed(1)} transform="rotate(-90 22 22)" /></svg>
          <div><span className="rd-desk-clock" role="timer" aria-label={`${timer.label}, ${clock(timer.left)} left`}>{clock(timer.left)}</span><small>{timer.label} · {timer.detail}</small></div>
        </div>
        <div className="rd-desk-actions">
          <button type="button" className={timer.action === 'Pause focus' ? 'secondary-button' : undefined} onClick={timer.toggle}>{timer.action}</button>
          <a className="text-button" href="#tools/focus">Open focus</a>
        </div>
      </section>
      <DeskMusic link={prefs.playlist} onLink={playlist => save({ ...prefs, playlist })} />
      <QuickNote />
      <SprintStats compact />
    </div>}
  </aside>
}

function DeskMusic({ link, onLink }: { link: string; onLink: (link: string) => void }) {
  const player = link ? parsePlaylist(link) : null
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(!player)
  const [error, setError] = useState('')
  const label = player ? SERVICE[player.provider] : ''

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('playlist') ?? '').trim()
    if (value && !parsePlaylist(value)) { setError('Paste a Spotify, YouTube or Apple Music link.'); return }
    setError(''); setLoaded(false); onLink(value); setEditing(!value)
  }

  return <section className="rd-desk-module" aria-labelledby="desk-music">
    <h3 id="desk-music">Music</h3>
    {editing || !player
      ? <form className="rd-desk-form" onSubmit={submit}>
          <label>Playlist link<input name="playlist" type="url" inputMode="url" defaultValue={link} placeholder="Spotify, YouTube or Apple Music" /></label>
          <button type="submit" className="secondary-button">Save</button>
          {error && <p role="alert" className="field-help">{error}</p>}
          <p className="field-help">The same links your character playlists accept. Kept in this browser.</p>
        </form>
      : loaded
        ? <><iframe className={`rd-desk-player is-${player.provider}`} src={player.embedUrl} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" referrerPolicy="strict-origin-when-cross-origin" title={`${label} player`} />
            <div className="rd-desk-actions"><button type="button" className="secondary-button" onClick={() => setLoaded(false)}>Hide player</button><button type="button" className="text-button" onClick={() => setEditing(true)}>Change link</button></div></>
        : <><button type="button" className="secondary-button rd-desk-wide" onClick={() => setLoaded(true)}>Load the {label} player</button>
            <p className="field-help">Loads {label}’s player, which follows {label}’s privacy policy.</p>
            <div className="rd-desk-actions"><a className="text-button" href={player.openUrl} target="_blank" rel="noopener noreferrer">Open in {label}</a><button type="button" className="text-button" onClick={() => setEditing(true)}>Change link</button></div></>}
  </section>
}

function QuickNote() {
  const [text, setText] = useState(() => restoreDraftLocal(NOTE_DRAFT) ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const note = text.trim()
    if (!note || saving) return
    setSaving(true); setError(''); setStatus('')
    try {
      await api('/reply-drafts', 'POST', { title: note.slice(0, 300), notes: note, purpose: 'note' })
      setText(''); clearDraftLocal(NOTE_DRAFT); setStatus('Saved to your Parking Lot.')
    } catch (problem) { setError((problem as Error).message) } finally { setSaving(false) }
  }

  return <section className="rd-desk-module" aria-labelledby="desk-note">
    <h3 id="desk-note">Quick note</h3>
    <form className="rd-desk-form" onSubmit={event => void submit(event)}>
      <label className="visually-hidden" htmlFor="desk-note-text">Quick note</label>
      <textarea id="desk-note-text" rows={3} maxLength={20000} value={text} placeholder="A line of dialogue, a plot idea…" onChange={event => { setText(event.target.value); saveDraftLocal(NOTE_DRAFT, event.target.value) }} />
      <button type="submit" className="secondary-button" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save to Parking Lot'}</button>
      <p role="status" className="field-help">{status}</p>
      {error && <p role="alert" className="field-help">{error}</p>}
    </form>
  </section>
}

/** Phones: a slim strip above the tab bar while a focus cycle runs. */
export function DeskBar() {
  const timer = useFocusSummary()
  if (timer.idle) return null
  return <div className="rd-deskbar" role="region" aria-label="Focus timer">
    <a href="#tools/focus" className="rd-deskbar-link"><span className="rd-deskbar-clock" role="timer" aria-label={`${timer.label}, ${clock(timer.left)} left`}>{clock(timer.left)}</span><small>{timer.label} · {timer.detail}</small></a>
    <button type="button" className="secondary-button" onClick={timer.toggle}>{timer.action}</button>
  </div>
}
