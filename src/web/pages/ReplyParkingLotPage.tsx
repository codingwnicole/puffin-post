import { useEffect, useState } from 'react'
import type { ReplyDraft } from '../../db/repositories/reply-drafts'
import { api, type TrackingOptions } from '../lib/api'
import StarterFields from '../components/StarterFields'

function DraftCard({ draft,options,reload,converted }: { draft:ReplyDraft; options:TrackingOptions; reload:() => Promise<void>; converted:() => void }) {
  const [converting,setConverting] = useState(false), [editing,setEditing] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('')
  async function update(patch:unknown) {
    setBusy(true); setError('')
    try { await api(`/reply-drafts/${draft.id}`,'PATCH',patch); await reload(); setEditing(false) }
    catch(e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <article className="tracking-card">
    <h3>{draft.title}</h3>
    {draft.reminderAt && <p>{new Date(draft.reminderAt).getTime() <= Date.now() ? 'Overdue · ' : 'Reminder · '}<time dateTime={draft.reminderAt}>{new Date(draft.reminderAt).toLocaleDateString()}</time></p>}
    <p className="preserve-lines">{draft.notes.slice(0,300)}{draft.notes.length > 300 ? '…' : ''}</p>
    {draft.sourceUrl && <p><a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a></p>}
    <div className="actions"><button disabled={busy} onClick={() => { setConverting(!converting); setEditing(false) }}>Convert to Tumblr</button>
      <button disabled={busy} onClick={() => { setEditing(!editing); setConverting(false) }}>Edit draft</button>
      <button disabled={busy} onClick={() => update({ state:'archived' })}>Archive draft</button></div>
    {editing && <form className="tracking-form" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget)
      void update({ title:data.get('title'),notes:data.get('notes'),sourceUrl:data.get('sourceUrl') || null,
        reminderAt:data.get('reminder') ? new Date(`${data.get('reminder')}T00:00:00.000Z`).toISOString() : null })
    }}>
      <label>Draft title<input name="title" required maxLength={300} defaultValue={draft.title} /></label>
      <label>Draft notes<textarea name="notes" maxLength={20000} defaultValue={draft.notes} /></label>
      <label>Source URL<input type="url" name="sourceUrl" defaultValue={draft.sourceUrl ?? ''} /></label>
      <label>Reminder date<input type="date" name="reminder" defaultValue={draft.reminderAt?.slice(0,10) ?? ''} /></label>
      <button disabled={busy}>Save draft</button>
    </form>}
    {converting && <form className="tracking-form" onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('')
      try { await api(`/reply-drafts/${draft.id}/convert`,'POST',{
        starter:{ title:data.get('title'),characterId:data.get('characterId'),rootBlogId:data.get('rootBlogId'),rootPostId:data.get('rootPostId') },
        branch:{ notes:data.get('notes'),partnerId:data.get('partnerId') || null },
      }); await reload(); converted() } catch(e) { setError((e as Error).message) } finally { setBusy(false) }
    }}>
      <p>Once posted on Tumblr, give this reply its own starter and branch. Conversion is permanent.</p>
      <StarterFields options={options} title={draft.title} characterId={draft.characterId ?? ''} />
      <label>Partner<select name="partnerId" defaultValue={draft.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Branch notes<textarea name="notes" maxLength={20000} defaultValue={draft.notes} /></label>
      <button disabled={busy}>Create starter and branch</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </article>
}

export default function ReplyParkingLotPage() {
  const [drafts,setDrafts] = useState<ReplyDraft[]>([]), [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] })
  const [overdue,setOverdue] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState(''), [busy,setBusy] = useState(false)
  async function reload() { setDrafts(await api(`/reply-drafts${overdue ? '?overdue=true' : ''}`)) }
  useEffect(() => {
    let active = true
    Promise.all([api<ReplyDraft[]>(`/reply-drafts${overdue ? '?overdue=true' : ''}`),api<TrackingOptions>('/starters/options')])
      .then(([drafts,options]) => { if (active) { setDrafts(drafts); setOptions(options); setError('') } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  },[overdue])
  return <section aria-labelledby="parking-title"><h2 className="page-heading" id="parking-title">Reply Parking Lot</h2>
    <p className="page-description">Keep owed DMs and unposted starters here. Add details yourself, then convert when the Tumblr post is ready.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="tracking-form tracking-card" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); setError(''); setMessage('')
      try { await api('/reply-drafts','POST',{ title:data.get('title'),notes:data.get('notes'),characterId:data.get('characterId') || null,
        partnerId:data.get('partnerId') || null,sourceUrl:data.get('sourceUrl') || null,
        reminderAt:data.get('reminder') ? new Date(`${data.get('reminder')}T00:00:00.000Z`).toISOString() : null }); form.reset(); await reload() }
      catch(e) { setError((e as Error).message) } finally { setBusy(false) }
    }}>
      <h3>Park a reply</h3>
      <label>Draft title<input name="title" required maxLength={300} /></label>
      <label>Draft notes<textarea name="notes" maxLength={20000} /></label>
      <label>Character (optional)<select name="characterId"><option value="">Choose later</option>{options.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Partner (optional)<select name="partnerId"><option value="">Choose later</option>{options.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Source URL<input type="url" name="sourceUrl" maxLength={2000} /></label>
      <label>Reminder date<input type="date" name="reminder" /></label>
      <button disabled={busy}>Park reply</button>
    </form>
    <label className="lane-filter">Show<select value={overdue ? 'overdue' : 'open'} onChange={event => setOverdue(event.target.value === 'overdue')}><option value="open">All open drafts</option><option value="overdue">Overdue drafts</option></select></label>
    {drafts.map(draft => <DraftCard key={`${draft.id}:${draft.updatedAt}`} draft={draft} options={options} reload={reload} converted={() => setMessage('Reply converted. Find its branch in your Inbox.')} />)}
    {!drafts.length && <p>No {overdue ? 'overdue' : 'open'} replies parked.</p>}
  </section>
}
