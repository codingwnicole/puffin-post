import SpinWheel from '../components/SpinWheel'
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react'
import type { ReplyDraft } from '../../db/repositories/reply-drafts'
import { api, clearDraftLocal, restoreDraftLocal, saveDraftLocal, type TrackingOptions } from '../lib/api'
import StarterFields from '../components/StarterFields'

function DraftCard({ draft, options, reload, converted, selected, selectionHandled }: { draft: ReplyDraft; options: TrackingOptions; reload: () => Promise<void>; converted: () => void; selected?: number; selectionHandled: () => void }) {
  const cardRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [converting, setConverting] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (selected) { setEditing(true); setConverting(false) } }, [selected])
  useEffect(() => {
    if (selected && editing) {
      cardRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      titleRef.current?.focus({ preventScroll: true })
      selectionHandled()
    }
  }, [selected, editing, selectionHandled])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Unsent draft text survives a failed save or a page reload in sessionStorage.
  const [notes, setNotes] = useState(draft.notes)
  const [notesKey] = useState(`draft:${draft.id}`)

  useEffect(() => {
    const kept = restoreDraftLocal(notesKey)
    if (kept !== null && kept !== draft.notes) setNotes(kept)
  }, [draft.id])

  useEffect(() => {
    if (notes !== draft.notes) saveDraftLocal(notesKey, notes)
    else clearDraftLocal(notesKey)
  }, [notes, draft.notes, draft.id])

  async function update(patch: unknown) {
    setBusy(true); setError('')
    try {
      await api(`/reply-drafts/${draft.id}`, 'PATCH', patch)
      clearDraftLocal(notesKey)
      await reload(); setEditing(false)
    }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  return <article ref={cardRef} className="tracking-card" data-pick-id={draft.id}>
    <h3>{draft.title}</h3>
    <p className="field-help draft-kind">{{ reply: 'Owed reply', plotting: 'Plotting or DM', starter_idea: 'Starter idea', note: 'General note' }[draft.purpose]}</p>
    {draft.characterIds.length > 0 && <p className="field-help">For: {draft.characterIds.map(id => options.characters.find(character => character.id === id)?.name).filter(Boolean).join(', ')}</p>}
    {draft.reminderAt && <p>{new Date(draft.reminderAt).getTime() <= Date.now() ? 'Overdue - ' : 'Reminder - '}<time dateTime={draft.reminderAt}>{new Date(draft.reminderAt).toLocaleDateString()}</time></p>}
    <p className="preserve-lines">{draft.notes.slice(0, 300)}{draft.notes.length > 300 ? '.' : ''}</p>
    {draft.sourceUrl && <p><a className="draft-source" href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a></p>}
    <div className="actions">
      {(draft.purpose === 'reply' || draft.purpose === 'starter_idea') && <button disabled={busy} onClick={() => { setConverting(!converting); setEditing(false) }}>Convert to Tumblr</button>}
      <button className="secondary-button" disabled={busy} onClick={() => { setEditing(!editing); setConverting(false) }}>Edit draft</button>
      <button className="secondary-button" disabled={busy} onClick={() => void update({ state: 'archived', notes })}>{draft.purpose==='plotting'?'Mark wrapped':'Archive draft'}</button>
      <button className="danger-button" disabled={busy} onClick={() => { if (!window.confirm('Delete this saved item permanently?')) return; void api(`/reply-drafts/${draft.id}`, 'DELETE').then(reload).catch(problem => setError(problem.message)) }}>Delete draft</button>
    </div>
    {editing && <form className="tracking-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); setNotes(String(data.get('notes') ?? '')); void update({ title: data.get('title'), notes: String(data.get('notes') ?? ''), purpose: data.get('purpose'), sourceUrl: data.get('sourceUrl') || null, reminderAt: data.get('reminder') ? new Date(`${data.get('reminder')}T00:00:00.000Z`).toISOString() : null }) }}>
      <label>Draft title<input ref={titleRef} name="title" required maxLength={300} defaultValue={draft.title} /></label><label>What is this for?<select name="purpose" defaultValue={draft.purpose}><option value="reply">An owed reply</option><option value="plotting">Plotting or a DM follow-up</option><option value="starter_idea">A starter idea</option><option value="note">A general note</option></select></label><label>Draft notes<textarea name="notes" disabled={busy} maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} /></label><label>Source URL<input type="url" name="sourceUrl" defaultValue={draft.sourceUrl ?? ''} /></label><label>Reminder date<input type="date" name="reminder" defaultValue={draft.reminderAt?.slice(0, 10) ?? ''} /></label><button disabled={busy}>Save draft</button>
    </form>}
    {converting && <form className="tracking-form" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(''); try { await api(`/reply-drafts/${draft.id}/convert`, 'POST', { starter: { title: data.get('title'), characterId: data.get('characterId'), postUrl: data.get('postUrl'), groupId: data.get('groupId') || null }, branch: { notes: data.get('notes'), partnerId: data.get('partnerId') || null } }); await reload(); converted() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>
      <p>Once posted on Tumblr, give this reply its own starter and branch. Conversion is permanent.</p><StarterFields options={options} title={draft.title} characterId={draft.characterId ?? ''} /><label>Partner<select name="partnerId" defaultValue={draft.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label><label>Branch notes<textarea name="notes" maxLength={20000} defaultValue={draft.notes} /></label><button disabled={busy}>Create starter and branch</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </article>
}

function PlottingPulse({ drafts, onChoose }: { drafts: ReplyDraft[]; onChoose: (id: string) => void }) {
  const plotting=drafts.filter(draft=>draft.purpose==='plotting'), now=Date.now()
  const due=plotting.filter(draft=>draft.reminderAt && new Date(draft.reminderAt).getTime()<=now).length
  const later=plotting.filter(draft=>draft.reminderAt && new Date(draft.reminderAt).getTime()>now).length
  const open=plotting.length-due-later, total=Math.max(plotting.length,1)
  const dueEnd=Math.round(due/total*100), laterEnd=dueEnd+Math.round(later/total*100)
  const openItems=drafts.filter(draft=>draft.state==='open').map(draft=>({id:draft.id,label:draft.title,context:{reply:'Owed reply',plotting:'Plotting or DM',starter_idea:'Starter idea',note:'General note'}[draft.purpose],actionLabel:draft.purpose==='starter_idea'?'View Idea':draft.purpose==='note'?'Open Note':draft.purpose==='plotting'?'Open Plot':'Open Draft'}))
  return <section className="plotting-pulse tracking-card summary-card" aria-label="Plotting pulse"><div className="plotting-donut" style={{'--due':`${dueEnd}%`,'--later':`${laterEnd}%`} as CSSProperties}><strong>{plotting.length}</strong><span>plots</span></div><div><h2>{plotting.length ? `${due} follow-up${due===1?'':'s'} due` : 'No plotting DMs parked'}</h2><p>{later} later · {open} open-ended. Mark a conversation wrapped when it is settled to clear it from the pulse.</p><SpinWheel title="Pick something from the Parking Lot" items={openItems} empty="Nothing parked right now." onChoose={item => onChoose(item.id)}/></div></section>
}

export default function ReplyParkingLotPage() {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([])
  const [selection, setSelection] = useState<{ id: string; revision: number } | null>(null)
  const [options, setOptions] = useState<TrackingOptions>({ characters: [], partners: [] })
  const [overdue, setOverdue] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [parkingPurpose, setParkingPurpose] = useState<'reply'|'plotting'|'starter_idea'|'note'>('reply')
  async function reload() { setDrafts(await api(`/reply-drafts${overdue ? '?overdue=true' : ''}`)) }

  useEffect(() => {
    let active = true
    Promise.all([api<ReplyDraft[]>(`/reply-drafts${overdue ? '?overdue=true' : ''}`), api<TrackingOptions>('/starters/options')]).then(([nextDrafts, nextOptions]) => { if (active) { setDrafts(nextDrafts); setOptions(nextOptions); setError('') } }).catch(problem => { if (active) setError(problem.message) })
    return () => { active = false }
  }, [overdue])

  async function park(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget, data = new FormData(form)
    setBusy(true); setError(''); setMessage('')
    try {
      let partnerId = data.get('partnerId') || null
      const typed = String(data.get('partnerText') || '').trim()
      if (typed && !partnerId) {
        const blog = typed.includes('.') ? typed : `${typed}.tumblr.com`
        partnerId = (await api<{ id: string }>('/partners', 'POST', { blogIdentifier: blog, displayLabel: typed })).id
      }
      const characterIds = data.getAll('characterIds').filter((value): value is string => typeof value === 'string' && Boolean(value))
      await api('/reply-drafts', 'POST', { title: data.get('title'), notes: data.get('notes'), purpose: data.get('purpose'), characterId: characterIds[0] || null, characterIds, partnerId, sourceUrl: data.get('sourceUrl') || null, reminderAt: data.get('reminder') ? new Date(`${data.get('reminder')}T00:00:00.000Z`).toISOString() : null })
      clearDraftLocal('park:new')
      form.reset(); setParkingPurpose('reply'); await reload()
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="parking-title">
    <h1 className="page-heading" id="parking-title">Parking Lot</h1>
    <p className="page-description">A private place to hold anything that is not a live tracked thread yet: owed replies, plotting or DM follow-ups, starter ideas, and loose notes.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label className="lane-filter">Show<select value={overdue ? 'overdue' : 'open'} onChange={event => setOverdue(event.target.value === 'overdue')}><option value="open">All open drafts</option><option value="overdue">Overdue drafts</option></select></label>
    <PlottingPulse drafts={drafts} onChoose={id => setSelection(current => ({ id, revision: (current?.revision ?? 0) + 1 }))}/>
    {drafts.filter(draft=>draft.purpose==='plotting').length>0&&<section className="parking-lane" aria-labelledby="plotting-lane"><h2 id="plotting-lane">Plotting & DM follow-ups</h2>{drafts.filter(draft=>draft.purpose==='plotting').map(draft => <DraftCard selectionHandled={() => setSelection(null)} selected={selection?.id === draft.id ? selection.revision : undefined} key={`${draft.id}:${draft.updatedAt}`} draft={draft} options={options} reload={reload} converted={() => setMessage('Reply converted. Find its branch on your Dashboard.')} />)}</section>}
    {drafts.filter(draft=>draft.purpose!=='plotting').length>0&&<section className="parking-lane" aria-labelledby="writing-lane"><h2 id="writing-lane">Drafts, replies & ideas</h2>{drafts.filter(draft=>draft.purpose!=='plotting').map(draft => <DraftCard selectionHandled={() => setSelection(null)} selected={selection?.id === draft.id ? selection.revision : undefined} key={`${draft.id}:${draft.updatedAt}`} draft={draft} options={options} reload={reload} converted={() => setMessage('Reply converted. Find its branch on your Dashboard.')} />)}</section>}
    {!drafts.length && <p>No {overdue ? 'overdue' : 'open'} replies parked.</p>}
    <details className="tracking-card parking-add">
      <summary><span><strong>Save something for later</strong></span><span aria-hidden="true">+</span></summary>
      <form className="tracking-form" onSubmit={park}>
        <label>Draft title<input name="title" required maxLength={300} /></label><label>What is this for?<select name="purpose" value={parkingPurpose} onChange={event=>setParkingPurpose(event.target.value as typeof parkingPurpose)}><option value="reply">An owed reply</option><option value="plotting">Plotting or a DM follow-up</option><option value="starter_idea">A starter idea</option><option value="note">A general note</option></select></label><label>Draft notes<textarea name="notes" maxLength={20000} defaultValue={restoreDraftLocal('park:new') ?? ''} onChange={event => saveDraftLocal('park:new', event.target.value)} /></label><label>Characters (optional)<select name="characterIds" multiple size={Math.min(5, Math.max(2, options.characters.length))}>{options.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select><span className="field-help">Choose more than one when this is a shared plot or multi-muse thread.</span></label><label>Partner (optional)<select name="partnerId"><option value="">Choose later</option>{options.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label><label>Or type a new partner<input name="partnerText" maxLength={200} placeholder="name or Tumblr blog" /></label><label>Source URL<input type="url" name="sourceUrl" maxLength={2000} /></label><label>Reminder date<input type="date" name="reminder" /></label><button disabled={busy}>{({reply:'Park reply',plotting:'Save plotting note',starter_idea:'Save starter idea',note:'Save note'} as const)[parkingPurpose]}</button>
      </form>
    </details>
  </section>
}
