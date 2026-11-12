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
    Promise.all([api<typeof inbox>(`/inbox${query.size ? `?${query}` : ''}`),api<TrackingOptions>('/starters/options'),api<{id:string;displayLabel:string}[]>('/tags').catch(() => [])])
      .then(([inbox,options,tags]) => { if (active) { setInbox(inbox); setOptions(options); setTags(tags); setLoaded(true) } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  },[filters.status,filters.characterId,filters.tagId,filters.q])
  const needsSignIn = error === 'Sign in to see your writing space.'
  return <section aria-labelledby="inbox-title">
    <h2 id="inbox-title" className="page-heading">Inbox</h2>
    <p className="page-description">See what needs your words next, then get out of the way and write.</p>
    {error && <p role="alert">{error}</p>}
    {!loaded && <div className="empty-state inbox-welcome"><span className="empty-mark" aria-hidden="true">t</span><h3>{needsSignIn ? 'Your threads stay yours.' : 'Opening your writing space…'}</h3><p>{needsSignIn ? 'Sign in with a one-time link to pick up exactly where you left off.' : 'Gathering the scenes that need you.'}</p></div>}
    {needsSignIn && <form className="tracking-form sign-in-form" onSubmit={async event => {
      event.preventDefault(); setError(''); setBusy(true)
      const email = new FormData(event.currentTarget).get('email')
      try { await api('/auth/magic-link', 'POST', { email }); setError('Check your email for a one-time sign-in link.') }
      catch (error) { setError((error as Error).message) } finally { setBusy(false) }
    }}><label>Email address<input name="email" type="email" autoComplete="email" required /></label><button disabled={busy}>{busy ? 'Sending link...' : 'Email me a sign-in link'}</button></form>}
    {loaded && <><div className="inbox-summary"><div><p className="eyebrow">At a glance</p><p className="reply-count" aria-live="polite">{inbox.yourTurnCount} {inbox.yourTurnCount === 1 ? 'reply needs' : 'replies need'} you</p></div><a className="text-action" href="#parking-lot">Park an owed reply</a></div>
      <FilterBar filters={filters} options={options} tags={tags} onChange={setFilters}/>
      {inbox.branches.map(branch => <BranchRow key={`${branch.id}:${branch.status}:${branch.notes}:${branch.partnerId}`} branch={branch} options={options} onChange={reload} />)}
      {!inbox.branches.length && <div className="empty-state onboarding"><p className="eyebrow">Start your first thread</p><h3>Build a space that keeps up with your stories.</h3><p>Connect Tumblr, add a character, then save an open starter once. Every participant gets their own reply branch.</p><ol><li><a href="#connections">Connect your Tumblr</a></li><li><a href="#characters">Add a character</a></li><li>Return here to track a starter</li></ol></div>}
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
