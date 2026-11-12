import { useEffect, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, type TrackingOptions } from '../lib/api'
import BranchRow, { statusLabel } from '../components/BranchRow'
import StarterFields from '../components/StarterFields'

export default function InboxPage() {
  const [inbox,setInbox] = useState<{ branches:InboxBranch[]; yourTurnCount:number }>({ branches:[],yourTurnCount:0 })
  const [lane,setLane] = useState(''), [error,setError] = useState(''), [loaded,setLoaded] = useState(false), [busy,setBusy] = useState(false)
  const [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] })
  async function reload() { setInbox(await api(`/inbox${lane ? `?status=${lane}` : ''}`)) }
  useEffect(() => {
    let active = true
    setError('')
    Promise.all([api<typeof inbox>(`/inbox${lane ? `?status=${lane}` : ''}`),api<TrackingOptions>('/starters/options')])
      .then(([inbox,options]) => { if (active) { setInbox(inbox); setOptions(options); setLoaded(true) } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  },[lane])
  return <section aria-labelledby="inbox-title">
    <h2 id="inbox-title" className="page-heading">Inbox</h2>
    <p className="page-description">A little order for your next chapter.</p>
    {error && <p role="alert">{error}</p>}
    {!loaded && <div className="empty-state"><h3>Your writing space</h3><p>{error ? 'Your replies are private. Sign in to see your Inbox.' : 'Loading your replies…'}</p></div>}
    {loaded && <><p className="reply-count" aria-live="polite">{inbox.yourTurnCount} {inbox.yourTurnCount === 1 ? 'reply needs' : 'replies need'} you</p>
      <label className="lane-filter">Show<select value={lane} onChange={e => setLane(e.target.value)}><option value="">All active replies</option>
        {['your_turn','their_turn','queued','archived'].map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      {inbox.branches.map(branch => <BranchRow key={`${branch.id}:${branch.status}:${branch.notes}:${branch.partnerId}`} branch={branch} options={options} onChange={reload} />)}
      {!inbox.branches.length && <div className="empty-state"><h3>A home for your next reply</h3><p>No replies in this view yet.</p></div>}
      <details className="tracking-card"><summary>Add Tumblr starter</summary>
        <form className="tracking-form" onSubmit={async event => {
          event.preventDefault(); setError(''); setBusy(true)
          const data = new FormData(event.currentTarget)
          try { const starter = await api<{ id:string }>('/starters','POST',Object.fromEntries(data)); window.location.hash = `starter/${starter.id}` }
          catch(e) { setError((e as Error).message) } finally { setBusy(false) }
        }}><StarterFields options={options} /><label>Shared description<textarea name="description" maxLength={20000} /></label><button disabled={busy}>Create starter</button></form>
      </details></>}
  </section>
}
