import { useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { REPLY_STATUSES } from '../../shared/domain'
import { api, type TrackingOptions } from '../lib/api'
import InitialsAvatar from './InitialsAvatar'

export const statusLabel = (status:string) => status.replaceAll('_',' ').replace(/^./,s => s.toUpperCase())
export default function BranchRow({ branch, options, onChange }: { branch:InboxBranch; options:TrackingOptions; onChange:() => Promise<void> }) {
  const [error,setError] = useState(''), [busy,setBusy] = useState(false)
  return <article className="tracking-card">
    <div className="branch-heading"><InitialsAvatar name={branch.characterName} /><div>
      <h3><a href={`#starter/${branch.starterId}`}>{branch.title}</a></h3>
      <p>{branch.characterName} · {branch.partnerLabel ?? 'No partner assigned'}</p>
    </div></div>
    <a href={`https://www.tumblr.com/${encodeURIComponent(branch.rootBlogId.replace(/\.tumblr\.com$/,''))}/${encodeURIComponent(branch.latestPostId ?? branch.rootPostId)}`} target="_blank" rel="noopener noreferrer">Open Tumblr post</a>
    {branch.lastActivityAt && <p>Last activity: <time dateTime={branch.lastActivityAt}>{new Date(branch.lastActivityAt).toLocaleString()}</time></p>}
    {branch.refreshError && <p className="refresh-warning" role="status"><strong>Refresh needs attention:</strong> {branch.refreshError}</p>}
    <form className="tracking-form" onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget)
      setBusy(true); setError('')
      try { await api(`/branches/${branch.id}`,'PATCH',{ status:data.get('status'),partnerId:data.get('partnerId') || null,notes:data.get('notes') }); await onChange() }
      catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }}>
      <label>Status<select name="status" defaultValue={branch.status}>{REPLY_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <label>Partner<select name="partnerId" defaultValue={branch.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Branch notes<textarea name="notes" maxLength={20000} defaultValue={branch.notes} /></label>
      <button disabled={busy}>Save branch</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </article>
}
