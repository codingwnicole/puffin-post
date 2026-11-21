import { useEffect, useRef, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { REPLY_STATUSES, type ReplyStatus } from '../../shared/domain'
import { api, type TrackingOptions } from '../lib/api'
import InitialsAvatar from './InitialsAvatar'

export const statusLabel = (status: string) => status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
// Turn status is told apart by icon, label and shape (filled vs outlined), never colour alone.
const TURN_ICONS: Record<string, string> = {
  your_turn: 'M20 3c-6 1-11 6-13 12l-2 6 2-1c1-3 3-5 5-6 1 2 0 4-1 5 5-2 8-7 9-16Z', // quill
  their_turn: 'M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9', // hourglass
}
export function TurnBadge({ status, pop = false }: { status: string; pop?: boolean }) {
  const icon = TURN_ICONS[status]
  return <span className={`status-badge turn-badge turn-${status}${pop ? ' turn-pop' : ''}`}>{icon && <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d={icon}/></svg>}{statusLabel(status)}</span>
}
const cleanPartner = (value: string) => value.replace(/\.tumblr\.com$/i, '').replace(/^@/, '')

export default function BranchRow({ branch, options, onChange }: { branch: InboxBranch; options: TrackingOptions; onChange: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [tags, setTags] = useState<{ id: string; displayLabel: string }[]>([])
  // Optimistic status flip for reversible turns only; the badge and the select
  // both read this, so the change is visible immediately and rolls back on error.
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const status = statusOverride ?? branch.status
  // Pop once when a thread becomes your turn while on screen (not on every page load).
  const previousStatus = useRef(status)
  const pop = previousStatus.current !== status && status === 'your_turn'
  useEffect(() => { previousStatus.current = status }, [status])
  const loadTags = () => api<{ id: string; displayLabel: string }[]>(`/tags/starters/${branch.starterId}`).then(setTags).catch(() => {})
  useEffect(() => { void loadTags() }, [branch.starterId])

  async function setTurn(next: ReplyStatus) {
    if (next === branch.status || next === 'archived') return
    setError('')
    setStatusOverride(next)
    try {
      await api(`/branches/${branch.id}`, 'PATCH', { status: next })
      await onChange()
      setStatusOverride(null) // server data is the source of truth again
    } catch (problem) {
      setStatusOverride(null) // roll back to the confirmed status
      setError((problem as Error).message)
    }
  }

  // Autosave runs on every blur; only write (and reload the inbox) when a field actually changed.
  const savedSnapshot = useRef<string | null>(null)
  const snapshot = (form: HTMLFormElement) => new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString()
  async function save(form: HTMLFormElement) {
    const current = snapshot(form)
    if (current === savedSnapshot.current) return
    const data = new FormData(form)
    setBusy(true)
    setError('')
    try {
      await Promise.all([
        api(`/branches/${branch.id}`, 'PATCH', { status: data.get('status'), partnerId: data.get('partnerId') || null, notes: data.get('notes'), nextCheckAt: data.get('nextCheckAt') ? new Date(`${data.get('nextCheckAt')}T09:00:00.000Z`).toISOString() : null }),
        api(`/starters/${branch.starterId}`, 'PATCH', { title: data.get('title'), description: data.get('description') }),
      ])
      savedSnapshot.current = current
      await onChange()
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  const isManual = branch.rootBlogId === 'manual'
  const partner = branch.partnerLabel ? cleanPartner(branch.partnerLabel) : 'writing partner'
  const displayTitle = /^(Tumblr thread|Untitled scene)$/i.test(branch.title) ? `${branch.characterName} × ${partner}` : branch.title
  const summary = branch.description || 'No scene summary yet — open this card to add one.'

  return <article data-pick-id={branch.id} className={`tracking-card branch-card status-${branch.status}${expanded ? ' is-expanded' : ''}`}>
    <button type="button" className="scene-card-trigger" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="branch-heading"><InitialsAvatar name={branch.characterName} imageUrl={branch.iconObjectKey ? `/api/characters/${branch.characterId}/icon?v=${encodeURIComponent(branch.iconObjectKey)}` : null}/><span className="branch-title"><span className="branch-meta">{branch.characterName} × {partner}</span><strong>{displayTitle}</strong></span><TurnBadge key={status} status={status} pop={pop}/></span>
      <span className="branch-premise">{summary}</span>
      <span className="scene-card-hint">{expanded ? 'Hide scene details' : 'Open scene details'}</span>
    </button>
    <div className="branch-turn-actions"><button type="button" className={status === 'your_turn' ? 'turn-button is-current' : 'turn-button'} aria-pressed={status === 'your_turn'} onClick={() => void setTurn('your_turn')}>Your turn</button><button type="button" className={status === 'their_turn' ? 'turn-button is-current' : 'turn-button'} aria-pressed={status === 'their_turn'} onClick={() => void setTurn('their_turn')}>Their turn</button></div>
    {expanded && <div className="scene-card-expanded">
      <div className="branch-details">
        {isManual ? <span className="manual-scene">Manual scene</span> : <><a className="open-tumblr button" href={`https://www.tumblr.com/${encodeURIComponent(branch.rootBlogId.replace(/\.tumblr\.com$/, ''))}/${encodeURIComponent(branch.latestPostId ?? branch.rootPostId)}`} target="_blank" rel="noopener noreferrer">Open on Tumblr</a><button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/reparse`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Refresh names</button></>}
        <span>{branch.lastActivityAt ? <>Updated <time dateTime={branch.lastActivityAt}>{new Date(branch.lastActivityAt).toLocaleString()}</time></> : 'Added manually'}</span>
        {branch.latestReplyExcerpt && <p className="preserve-lines branch-excerpt">{branch.latestReplyExcerpt}</p>}
        {branch.starterArchived === 1 && <span className="status-badge status-archived">Archived thread</span>}
      </div>
      <div className="thread-tags">{tags.map(tag => <span key={tag.id}>{tag.displayLabel}<button type="button" aria-label={`Remove ${tag.displayLabel}`} onClick={() => void api(`/tags/${tag.id}/starters/${branch.starterId}`, 'DELETE').then(loadTags)}>×</button></span>)}<button type="button" className="text-button" onClick={async () => { const label = window.prompt('Add a label, such as important, event, or past'); if (!label?.trim()) return; try { const tag = await api<{ id: string }>('/tags', 'POST', { label }); await api(`/tags/${tag.id}/starters/${branch.starterId}`, 'POST'); await loadTags() } catch (problem) { setError((problem as Error).message) } }}>+ Add label</button></div>
      {branch.refreshError && <p className="refresh-warning" role="status"><strong>Refresh needs attention:</strong> {branch.refreshError}</p>}
      <div className="branch-manage"><p className="field-help">Edits save automatically when you leave a field.</p><form className="tracking-form branch-editor" onSubmit={event => event.preventDefault()} onFocus={event => { savedSnapshot.current ??= snapshot(event.currentTarget) }} onBlur={event => void save(event.currentTarget)}>
        <label className="branch-notes">Scene label<input name="title" maxLength={300} defaultValue={branch.title}/><span className="field-help">Try {branch.characterName.toLowerCase()} × partner #1 — premise.</span></label>
        <label className="branch-notes">Premise<input name="description" maxLength={20000} defaultValue={branch.description ?? ''} placeholder="A short summary of the scene"/></label>
        <label>Status<select name="status" defaultValue={branch.status}>{REPLY_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
        <label>Partner<select name="partnerId" defaultValue={branch.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(partnerOption => <option key={partnerOption.id} value={partnerOption.id}>{partnerOption.name}</option>)}</select></label>
        <label className="branch-notes">Thread notes<textarea name="notes" maxLength={20000} defaultValue={branch.notes}/></label>
        <label>Reminder to check back<input name="nextCheckAt" type="date" defaultValue={branch.nextCheckAt?.slice(0, 10) ?? ''}/><span className="field-help">Thread Buddy includes this in browser reminders on or after the date.</span></label>
        <span className="autosave-note"><span className="save-state" aria-hidden={!busy} style={{opacity:busy?1:0}}>Saving…</span><span className="save-state" aria-hidden={busy} style={{opacity:busy?0:1}}>{error ? 'Not saved' : 'Saved automatically'}</span></span>{branch.starterArchived === 1 && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/restore`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Restore thread</button>}<button type="button" className="danger-button" disabled={busy} onClick={async () => { if (!window.confirm('Delete this entire thread and every reply branch?')) return; try { setBusy(true); await api(`/starters/${branch.starterId}`, 'DELETE'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Delete thread</button>{error && <p role="alert">{error}</p>}
      </form></div>
    </div>}
  </article>
}
