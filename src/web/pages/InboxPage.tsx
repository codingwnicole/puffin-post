import { useEffect, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, type TrackingOptions } from '../lib/api'
import BranchRow, { statusLabel } from '../components/BranchRow'
import StarterFields from '../components/StarterFields'
import FilterBar, { type InboxFilters } from '../components/FilterBar'

export default function InboxPage() {
  const [inbox,setInbox] = useState<{ branches:InboxBranch[]; yourTurnCount:number }>({ branches:[],yourTurnCount:0 })
  const [filters,setFilters] = useState<InboxFilters>({status:'',characterId:'',tagId:'',q:''}), [error,setError] = useState(''), [loaded,setLoaded] = useState(false), [busy,setBusy] = useState(false)
  const [tags,setTags] = useState<{id:string;displayLabel:string}[]>([])
  const [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] })
  const query = new URLSearchParams(Object.entries(filters).filter(([,value])=>value))
  async function reload() { setInbox(await api(`/inbox${query.size ? `?${query}` : ''}`)) }
  useEffect(() => {
    let active = true
    setError('')
    Promise.all([api<typeof inbox>(`/inbox${query.size ? `?${query}` : ''}`),api<TrackingOptions>('/starters/options'),api<{id:string;displayLabel:string}[]>('/tags')])
      .then(([inbox,options,tags]) => { if (active) { setInbox(inbox); setOptions(options); setTags(tags); setLoaded(true) } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  },[filters.status,filters.characterId,filters.tagId,filters.q])
  const needsSignIn = error === 'Sign in to see your writing space.'
  return <section aria-labelledby="inbox-title">
    <h2 id="inbox-title" className="page-heading">Inbox</h2>
    <p className="page-description">A little order for your next chapter.</p>
    {error && <p role="alert">{error}</p>}
    {!loaded && <div className="empty-state"><h3>Your writing space</h3><p>{error ? 'Your replies are private. Sign in to see your Inbox.' : 'Loading your replies…'}</p></div>}
    {needsSignIn && <form className="tracking-form" onSubmit={async event => {
      event.preventDefault(); setError(''); setBusy(true)
      const email = new FormData(event.currentTarget).get('email')
      try { await api('/auth/magic-link', 'POST', { email }); setError('Check your email for a one-time sign-in link.') }
      catch (error) { setError((error as Error).message) } finally { setBusy(false) }
    }}><label>Email address<input name="email" type="email" autoComplete="email" required /></label><button disabled={busy}>{busy ? 'Sending link...' : 'Email me a sign-in link'}</button></form>}
    {loaded && <><p className="reply-count" aria-live="polite">{inbox.yourTurnCount} {inbox.yourTurnCount === 1 ? 'reply needs' : 'replies need'} you</p>
      <FilterBar filters={filters} options={options} tags={tags} onChange={setFilters}/>
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
