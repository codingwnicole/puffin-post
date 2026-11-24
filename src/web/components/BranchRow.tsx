import { useEffect, useRef, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { REPLY_STATUSES, type ReplyStatus } from '../../shared/domain'
import { api, type TrackingOptions } from '../lib/api'
import InitialsAvatar from './InitialsAvatar'
import Icon from './Icon'

export const statusLabel = (status: string) => status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
// Turn status is told apart by icon, label and shape (filled vs outlined), never colour alone.
const TURN_ICONS = { your_turn: 'your-turn', their_turn: 'their-turn' } as const
export function TurnBadge({ status, pop = false }: { status: string; pop?: boolean }) {
  const icon = TURN_ICONS[status as keyof typeof TURN_ICONS]
  return <span className={`status-badge turn-badge turn-${status}${pop ? ' turn-pop' : ''}`}>{icon && <Icon name={icon} />}{statusLabel(status)}</span>
}
const cleanPartner = (value: string) => value.replace(/\.tumblr\.com$/i, '').replace(/^@/, '')

export default function BranchRow({ branch, options, onChange }: { branch: InboxBranch; options: TrackingOptions; onChange: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(`rptb-scene-details:${branch.id}`) === 'shown' } catch { return false }
  })
  const [tags, setTags] = useState<{ id: string; displayLabel: string }[]>([])
  // Optimistic status flip for reversible turns only; the badge and the select
  // both read this, so the change is visible immediately and rolls back on error.
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const status = statusOverride ?? branch.status
  const toggleExpanded = () => setExpanded(current => {
    const next = !current
    try { localStorage.setItem(`rptb-scene-details:${branch.id}`, next ? 'shown' : 'hidden') } catch { /* Storage may be unavailable in private browsing. */ }
    return next
  })
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
      const partnerMuses=String(data.get('partnerMuses')??'').split(',').map(name=>name.trim()).filter(Boolean).slice(0,8)
      const branchPatch:Record<string,unknown>={}
      const statusValue=String(data.get('status')??'')
      const partnerValue=String(data.get('partnerId')??'')||null
      const notesValue=String(data.get('notes')??'')
      const nextCheckValue=data.get('nextCheckAt')?new Date(`${data.get('nextCheckAt')}T09:00:00.000Z`).toISOString():null
      if(statusValue!==branch.status)branchPatch.status=statusValue
      if(partnerValue!==branch.partnerId)branchPatch.partnerId=partnerValue
      if(notesValue!==branch.notes)branchPatch.notes=notesValue
      if((nextCheckValue?.slice(0,10)??null)!==(branch.nextCheckAt?.slice(0,10)??null))branchPatch.nextCheckAt=nextCheckValue
      if(partnerMuses.join(', ') !== (branch.partnerMuses??[]).join(', ')) branchPatch.partnerMuses=partnerMuses
      if(String(data.get('userRecap')??'') !== (branch.userRecap??'')) branchPatch.userRecap=data.get('userRecap')
      const requests:Promise<unknown>[]=[]
      if(Object.keys(branchPatch).length)requests.push(api(`/branches/${branch.id}`, 'PATCH', branchPatch))
      const title=String(data.get('title')??''),description=String(data.get('description')??'')
      if(title!==branch.title||description!==(branch.description??'')) requests.push(api(`/starters/${branch.starterId}`, 'PATCH', {...(title!==branch.title?{title}:{}),...(description!==(branch.description??'')?{description}:{})}))
      if(!requests.length){savedSnapshot.current=current;return}
      await Promise.all(requests)
      savedSnapshot.current = current
      await onChange()
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  const isManual = branch.rootBlogId === 'manual'
  const archived = branch.starterArchived === 1 || Boolean(branch.archivedAt) || branch.status === 'archived'
  // The latest reply lives on whoever posted it; pairing its id with the starter's blog linked to a post that doesn't exist.
  // Built only where the link renders (non-manual scenes), like the old inline expression.
  const tumblrHref = () => {
    const latest = branch.latestPostId && branch.lastPoster
      ? { blog: branch.lastPoster, post: branch.latestPostId }
      : { blog: branch.rootBlogId, post: branch.rootPostId }
    return `https://www.tumblr.com/${encodeURIComponent(latest.blog.replace(/\.tumblr\.com$/, ''))}/${encodeURIComponent(latest.post)}`
  }
  const partner = branch.partnerLabel ? cleanPartner(branch.partnerLabel) : 'writing partner'
  const displayTitle = /^(Tumblr thread|Untitled scene)$/i.test(branch.title) ? `${branch.characterName} × ${partner}` : branch.title
  const summary = branch.description || 'No scene summary yet — open this card to add one.'
  const displayedStatus = archived ? 'archived' : status

  return <article data-pick-id={branch.id} className={`tracking-card branch-card status-${displayedStatus}${expanded ? ' is-expanded' : ''}`}>
    <button type="button" className="scene-card-trigger" aria-expanded={expanded} aria-controls={`scene-details-${branch.id}`} onClick={toggleExpanded}>
      <span className="branch-heading"><InitialsAvatar name={branch.characterName} imageUrl={branch.iconObjectKey ? `/api/characters/${branch.characterId}/icon?v=${encodeURIComponent(branch.iconObjectKey)}` : null}/><span className="branch-title"><span className="branch-meta">{branch.characterName} × {partner}</span><strong>{displayTitle}</strong></span><TurnBadge key={displayedStatus} status={displayedStatus} pop={!archived&&pop}/></span>
      <span className="branch-premise">{summary}</span>
      <span className="scene-card-hint"><span aria-hidden="true">{expanded ? '−' : '+'}</span>{expanded ? 'Hide scene details' : 'Show scene details'}</span>
    </button>
    {!archived&&<div className="branch-turn-actions"><button type="button" className={status === 'your_turn' ? 'turn-button is-current' : 'turn-button'} aria-pressed={status === 'your_turn'} onClick={() => void setTurn('your_turn')}>Your turn</button><button type="button" className={status === 'their_turn' ? 'turn-button is-current' : 'turn-button'} aria-pressed={status === 'their_turn'} onClick={() => void setTurn('their_turn')}>Their turn</button></div>}
    {expanded && <div className="scene-card-expanded" id={`scene-details-${branch.id}`}>
      <div className="branch-details">
        {isManual ? <span className="manual-scene">Manual scene</span> : <><a className="open-tumblr button" href={tumblrHref()} target="_blank" rel="noopener noreferrer">Open on Tumblr</a><button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/reparse`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Refresh names</button></>}
        <span>{branch.lastActivityAt ? <>Updated <time dateTime={branch.lastActivityAt}>{new Date(branch.lastActivityAt).toLocaleString()}</time></> : 'Added manually'}</span>
        {branch.latestReplyExcerpt && <p className="preserve-lines branch-excerpt">{branch.latestReplyExcerpt}</p>}
        {(branch.partnerMuses??[]).length>0&&<span className="branch-muses">Partner muse{branch.partnerMuses!.length===1?'':'s'}: {branch.partnerMuses!.join(', ')}</span>}
        {archived && <span className="status-badge status-archived">{branch.starterArchived === 1 ? 'Archived thread' : 'Archived reply'}</span>}
        <a className="button secondary-button" href={`#starter/${branch.starterId}`}>Thread details &amp; archive settings</a>
      </div>
      <div className="thread-tags">{tags.map(tag => <span key={tag.id}>{tag.displayLabel}<button type="button" aria-label={`Remove ${tag.displayLabel}`} onClick={() => void api(`/tags/${tag.id}/starters/${branch.starterId}`, 'DELETE').then(loadTags, problem => setError((problem as Error).message))}>×</button></span>)}<button type="button" className="text-button" onClick={async () => { const label = window.prompt('Add a label, such as important, event, or past'); if (!label?.trim()) return; try { const tag = await api<{ id: string }>('/tags', 'POST', { label }); await api(`/tags/${tag.id}/starters/${branch.starterId}`, 'POST'); await loadTags() } catch (problem) { setError((problem as Error).message) } }}>+ Add label</button></div>
      {branch.refreshError && <p className="refresh-warning" role="status"><strong>Refresh needs attention:</strong> {branch.refreshError}</p>}
      <div className="branch-manage"><p className="field-help">Edits save automatically when you leave a field.</p><form className="tracking-form branch-editor" onSubmit={event => event.preventDefault()} onFocus={event => { savedSnapshot.current ??= snapshot(event.currentTarget) }} onBlur={event => void save(event.currentTarget)}>
        <label className="branch-notes">Scene label<input name="title" maxLength={300} defaultValue={branch.title}/><span className="field-help">Try {branch.characterName.toLowerCase()} × partner #1 — premise.</span></label>
        <label className="branch-notes">Stable premise<input name="description" maxLength={20000} defaultValue={branch.description ?? ''} placeholder="A short summary of the starter scene"/></label>
        <label>Partner muse names<input name="partnerMuses" maxLength={500} defaultValue={(branch.partnerMuses??[]).join(', ')} placeholder={partner}/><span className="field-help">If unknown, leave the Tumblr handle as your reference.</span></label>
        <label className="branch-notes">Your recap / next step<textarea name="userRecap" maxLength={1000} defaultValue={branch.userRecap ?? ''} placeholder="Your own reminder. Tumblr sync never changes this."/></label>
        {!archived&&<label>Status<select name="status" defaultValue={branch.status}>{REPLY_STATUSES.filter(status=>status!=='archived').map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>}
        <label>Partner<select name="partnerId" defaultValue={branch.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(partnerOption => <option key={partnerOption.id} value={partnerOption.id}>{partnerOption.name}</option>)}</select></label>
        <label className="branch-notes">Thread notes<textarea name="notes" maxLength={20000} defaultValue={branch.notes}/></label>
        <label>Reminder to check back<input name="nextCheckAt" type="date" defaultValue={branch.nextCheckAt?.slice(0, 10) ?? ''}/><span className="field-help">Thread Buddy includes this in browser reminders on or after the date.</span></label>
        <span className="autosave-note"><span className="save-state" aria-hidden={!busy} style={{opacity:busy?1:0}}>Saving…</span><span className="save-state" aria-hidden={busy} style={{opacity:busy?0:1}}>{error ? 'Not saved' : 'Saved automatically'}</span></span>{branch.starterArchived === 1 && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/restore`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Restore thread</button>}{branch.status==='archived'&&branch.starterArchived!==1&&<button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{setBusy(true);setError('');await api(`/branches/${branch.id}/restore`,'POST');await onChange()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}}>Restore reply</button>}{!archived&&<button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{setBusy(true);setError('');await api(`/branches/${branch.id}/archive`,'POST');await onChange()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}}>Archive reply</button>}<button type="button" className="danger-button" disabled={busy} onClick={async () => { if (!window.confirm('Delete this entire thread and every reply branch?')) return; try { setBusy(true); await api(`/starters/${branch.starterId}`, 'DELETE'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Delete thread</button>{error && <p role="alert">{error}</p>}
      </form></div>
    </div>}
  </article>
}
