import { useEffect, useRef, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { REPLY_STATUSES, type ReplyStatus } from '../../shared/domain'
import { api, type TrackingOptions } from '../lib/api'
import InitialsAvatar from './InitialsAvatar'
import Icon from './Icon'
import { useNativeDialog } from '../lib/dialog'
import { toast } from '../lib/toast'
import { runSceneMove, useSceneMoving } from '../lib/motion'
import { tumblrThreadHref } from '../lib/tumblr-links'

export const statusLabel = (status: string) => status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
// Turn status is told apart by icon, label and shape (filled vs outlined), never colour alone.
const TURN_ICONS = { your_turn: 'your-turn', their_turn: 'their-turn' } as const
export function TurnBadge({ status, pop = false }: { status: string; pop?: boolean }) {
  const icon = TURN_ICONS[status as keyof typeof TURN_ICONS]
  return <span className={`status-badge turn-badge turn-${status}${pop ? ' turn-pop' : ''}`}>{icon && <Icon name={icon} />}{statusLabel(status)}</span>
}
const cleanPartner = (value: string) => value.replace(/\.tumblr\.com$/i, '').replace(/^@/, '')

// showAvatar=false inside a character stack, whose header already shows the character.
export default function BranchRow({ branch, options, onChange, showAvatar = true }: { branch: InboxBranch; options: TrackingOptions; onChange: () => Promise<void>; showAvatar?: boolean }) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [addingLabel, setAddingLabel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useNativeDialog(dialogRef, expanded)
  // React removes the dialog on close, which skips the browser's own focus return; send focus back to the card.
  const wasExpanded = useRef(false)
  useEffect(() => { if (wasExpanded.current && !expanded) triggerRef.current?.focus(); wasExpanded.current = expanded }, [expanded])
  const [tags, setTags] = useState<{ id: string; displayLabel: string }[]>([])
  // Optimistic status flip for reversible turns only; the badge and the select
  // both read this, so the change is visible immediately and rolls back on error.
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const sceneMoving = useSceneMoving()
  const status = statusOverride ?? branch.status
  const toggleExpanded = () => setExpanded(current => !current)
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
      const previous = branch.status
      await api(`/branches/${branch.id}`, 'PATCH', { status: next })
      await runSceneMove(onChange) // the card glides to its new section
      setStatusOverride(null) // server data is the source of truth again
      // The card moves to its new section on reload, so say where it went and offer the way back.
      const name = displayTitle.length > 40 ? `${displayTitle.slice(0, 39)}…` : displayTitle
      toast(next === 'your_turn' ? `${name} is your turn again.` : `${name} moved to waiting.`,
        async () => { await api(`/branches/${branch.id}`, 'PATCH', { status: previous }); await runSceneMove(onChange) })
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

  // Closing saves first: the form autosaves on blur, and closing the drawer would otherwise skip that blur.
  function closeDetails() {
    if (formRef.current) void save(formRef.current)
    setAddingLabel(false); setConfirmDelete(false); setExpanded(false)
  }
  async function addLabel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = String(new FormData(event.currentTarget).get('label') ?? '').trim()
    if (!label) return
    try { const tag = await api<{ id: string }>('/tags', 'POST', { label }); await api(`/tags/${tag.id}/starters/${branch.starterId}`, 'POST'); await loadTags(); setAddingLabel(false) }
    catch (problem) { setError((problem as Error).message) }
  }
  async function deleteThread() {
    try { setBusy(true); await api(`/starters/${branch.starterId}`, 'DELETE'); setExpanded(false); await onChange() }
    catch (problem) { setError((problem as Error).message) } finally { setBusy(false); setConfirmDelete(false) }
  }

  const isManual = branch.rootBlogId === 'manual'
  const archived = branch.starterArchived === 1 || Boolean(branch.archivedAt) || branch.status === 'archived'
  // The latest reply lives on whoever posted it; pairing its id with the starter's blog linked to a post that doesn't exist.
  // Built only where the link renders (non-manual scenes), like the old inline expression.
  const tumblrHref = () => tumblrThreadHref(branch) ?? undefined
  const partner = branch.partnerLabel ? cleanPartner(branch.partnerLabel) : 'writing partner'
  const displayTitle = /^(Tumblr thread|Untitled scene)$/i.test(branch.title) ? `${branch.characterName} × ${partner}` : branch.title
  const summary = branch.description || 'No scene summary yet — open this card to add one.'
  const displayedStatus = archived ? 'archived' : status
  // The pairing line only adds something when the title is not already "Character × partner".
  const pairing = `${branch.characterName} × ${partner}`
  const pairingRepeats = String(displayTitle ?? '').toLowerCase() === pairing.toLowerCase()

  return <article data-pick-id={branch.id} className={`tracking-card branch-card status-${displayedStatus}${expanded ? ' is-expanded' : ''}`} style={sceneMoving ? { viewTransitionName: `scene-${branch.id}`, viewTransitionClass: 'scene' } as React.CSSProperties : undefined}>
    <button ref={triggerRef} type="button" className="scene-card-trigger" aria-label={`${expanded ? 'Hide' : 'Show'} scene details: ${displayTitle}, ${archived ? 'archived' : statusLabel(displayedStatus)}`} aria-expanded={expanded} aria-controls={`scene-details-${branch.id}`} onClick={toggleExpanded}>
      <span className="branch-heading">{showAvatar && <InitialsAvatar name={branch.characterName} imageUrl={branch.iconObjectKey ? `/api/characters/${branch.characterId}/icon?v=${encodeURIComponent(branch.iconObjectKey)}` : null}/>}<span className="branch-title"><span className={pairingRepeats ? 'branch-meta visually-hidden' : 'branch-meta'}>{pairing}</span><strong>{displayTitle}</strong></span>{archived ? <span className="status-badge turn-badge turn-archived">{branch.starterArchived === 1 ? 'Archived thread' : 'Archived reply'}</span> : <TurnBadge key={displayedStatus} status={displayedStatus} pop={pop}/>}</span>
      <span className="branch-premise">{summary}</span>
      <span className="scene-card-hint" aria-hidden="true">Details</span>
    </button>
    {/* One clear action per state: "I replied" on owed scenes, "Their reply came in" on waiting ones. Queued scenes
        have no current turn yet, so both choices show. The scene drawer's Status field still sets any state. */}
    {!archived&&<div className="branch-turn-actions">{status === 'your_turn'
      ? <button type="button" className="turn-action" disabled={statusOverride !== null} onClick={() => void setTurn('their_turn')}>I replied</button>
      : status === 'their_turn'
        ? <button type="button" className="secondary-button turn-action" disabled={statusOverride !== null} onClick={() => void setTurn('your_turn')}>Their reply came in</button>
        : <><button type="button" className="secondary-button turn-action" disabled={statusOverride !== null} onClick={() => void setTurn('your_turn')}>Your turn</button><button type="button" className="secondary-button turn-action" disabled={statusOverride !== null} onClick={() => void setTurn('their_turn')}>Their turn</button></>}</div>}
    {expanded && <dialog ref={dialogRef} className="scene-drawer" aria-labelledby={`scene-title-${branch.id}`} onCancel={event => { event.preventDefault(); closeDetails() }} onClick={event => { if (event.target === event.currentTarget) closeDetails() }}><div className="scene-card-expanded" id={`scene-details-${branch.id}`}>
      <header className="scene-drawer-head"><div><span className="branch-meta">{branch.characterName} × {partner}</span><h2 id={`scene-title-${branch.id}`}>{displayTitle}</h2></div><button type="button" className="secondary-button scene-drawer-close" onClick={closeDetails}>Close</button></header>
      <div className="branch-details">
        {isManual ? <span className="manual-scene">Manual scene</span> : <><a className="open-tumblr button" href={tumblrHref()} target="_blank" rel="noopener noreferrer">Open on Tumblr</a><button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/reparse`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Refresh names</button></>}
        <span>{branch.lastActivityAt ? <>Updated <time dateTime={branch.lastActivityAt}>{new Date(branch.lastActivityAt).toLocaleString()}</time></> : 'Added manually'}</span>
        {branch.latestReplyExcerpt && <p className="preserve-lines branch-excerpt">{branch.latestReplyExcerpt}</p>}
        {(branch.partnerMuses??[]).length>0&&<span className="branch-muses">Partner muse{branch.partnerMuses!.length===1?'':'s'}: {branch.partnerMuses!.join(', ')}</span>}
        <a className="button secondary-button" href={`#starter/${branch.starterId}`}>Thread details &amp; archive settings</a>
      </div>
      <div className="thread-tags">{tags.map(tag => <span key={tag.id}>{tag.displayLabel}<button type="button" aria-label={`Remove ${tag.displayLabel}`} onClick={() => void api(`/tags/${tag.id}/starters/${branch.starterId}`, 'DELETE').then(loadTags, problem => setError((problem as Error).message))}>×</button></span>)}{addingLabel ? <form className="label-add" onSubmit={event => void addLabel(event)}><label>New label<input name="label" maxLength={60} autoFocus placeholder="important, event, past…" /></label><button type="submit">Add</button><button type="button" className="secondary-button" onClick={() => setAddingLabel(false)}>Cancel</button></form> : <button type="button" className="text-button" onClick={() => setAddingLabel(true)}>+ Add label</button>}</div>
      {branch.refreshError && <p className="refresh-warning" role="status"><strong>Refresh needs attention:</strong> {branch.refreshError}</p>}
      <div className="branch-manage"><p className="field-help">Edits save automatically when you leave a field.</p><form ref={formRef} className="tracking-form branch-editor" onSubmit={event => event.preventDefault()} onFocus={event => { savedSnapshot.current ??= snapshot(event.currentTarget) }} onBlur={event => void save(event.currentTarget)}>
        <label className="branch-notes">Scene label<input name="title" maxLength={300} defaultValue={branch.title}/><span className="field-help">Try {branch.characterName.toLowerCase()} × partner #1 — premise.</span></label>
        <label className="branch-notes">Scene premise<input name="description" maxLength={20000} defaultValue={branch.description ?? ''} placeholder="A short summary of the starter scene"/></label>
        <label>Partner muse names<input name="partnerMuses" maxLength={500} defaultValue={(branch.partnerMuses??[]).join(', ')} placeholder={partner}/><span className="field-help">If unknown, leave the Tumblr handle as your reference.</span></label>
        <label className="branch-notes">Your recap / next step<textarea name="userRecap" maxLength={1000} defaultValue={branch.userRecap ?? ''} placeholder="Your own reminder. Tumblr sync never changes this."/></label>
        {!archived&&<label>Status<select name="status" defaultValue={branch.status}>{REPLY_STATUSES.filter(status=>status!=='archived').map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>}
        <label>Partner<select name="partnerId" defaultValue={branch.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(partnerOption => <option key={partnerOption.id} value={partnerOption.id}>{partnerOption.name}</option>)}</select></label>
        <label className="branch-notes">Thread notes<textarea name="notes" maxLength={20000} defaultValue={branch.notes}/></label>
        <label>Reminder to check back<input name="nextCheckAt" type="date" defaultValue={branch.nextCheckAt?.slice(0, 10) ?? ''}/><span className="field-help">Thread Buddy includes this in browser reminders on or after the date.</span></label>
        <span className="autosave-note"><span className="save-state" aria-hidden={!busy} style={{opacity:busy?1:0}}>Saving…</span><span className="save-state" aria-hidden={busy} style={{opacity:busy?0:1}}>{error ? 'Not saved' : 'Saved automatically'}</span></span>{branch.starterArchived === 1 && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); setError(''); await api(`/starters/${branch.starterId}/restore`, 'POST'); await onChange() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Restore thread</button>}{branch.status==='archived'&&branch.starterArchived!==1&&<button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{setBusy(true);setError('');await api(`/branches/${branch.id}/restore`,'POST');await onChange()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}}>Restore reply</button>}{!archived&&<button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{setBusy(true);setError('');await api(`/branches/${branch.id}/archive`,'POST');await onChange()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}}>Archive reply</button>}<button type="button" className="danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete thread</button>{confirmDelete && <div className="inline-confirm" role="alert"><p><strong>Delete this entire thread and every reply branch?</strong> This can't be undone.</p><div><button type="button" className="danger-button" disabled={busy} onClick={() => void deleteThread()}>{busy ? 'Deleting…' : 'Delete thread'}</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep it</button></div></div>}{error && <p role="alert">{error}</p>}
      </form></div>
    </div></dialog>}
  </article>
}
