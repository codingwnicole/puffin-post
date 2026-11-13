import { useEffect, useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { REPLY_STATUSES } from '../../shared/domain'
import { api, type TrackingOptions } from '../lib/api'
import InitialsAvatar from './InitialsAvatar'

export const statusLabel = (status:string) => status.replaceAll('_',' ').replace(/^./,s => s.toUpperCase())

export default function BranchRow({ branch, options, onChange }: { branch:InboxBranch; options:TrackingOptions; onChange:() => Promise<void> }) {
  const [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const [tags,setTags] = useState<{id:string;displayLabel:string}[]>([])
  const loadTags=()=>api<{id:string;displayLabel:string}[]>(`/tags/starters/${branch.starterId}`).then(setTags).catch(()=>{})
  useEffect(()=>{void loadTags()},[branch.starterId])
  return <article className={`tracking-card branch-card status-${branch.status}`}>
    <div className="branch-heading"><InitialsAvatar name={branch.characterName} imageUrl={branch.iconObjectKey ? `/api/characters/${branch.characterId}/icon?v=${encodeURIComponent(branch.iconObjectKey)}` : null}/><div className="branch-title"><p className="branch-meta">{branch.characterName} × {branch.partnerLabel ?? 'writing partner'}</p><h3><a href={`#starter/${branch.starterId}`}>{branch.title}</a></h3></div><span className="status-badge">{statusLabel(branch.status)}</span></div>
    {branch.description && <p className="branch-premise">{branch.description}</p>}
    <div className="branch-details"><a className="open-tumblr" href={`https://www.tumblr.com/${encodeURIComponent(branch.rootBlogId.replace(/\.tumblr\.com$/,''))}/${encodeURIComponent(branch.latestPostId ?? branch.rootPostId)}`} target="_blank" rel="noopener noreferrer">↗ Open on Tumblr</a><span>{branch.lastActivityAt ? <>Updated <time dateTime={branch.lastActivityAt}>{new Date(branch.lastActivityAt).toLocaleString()}</time></> : 'No activity recorded yet'}</span></div>
    <div className="thread-tags">{tags.map(tag=><span key={tag.id}>{tag.displayLabel}<button type="button" aria-label={`Remove ${tag.displayLabel}`} onClick={()=>void api(`/tags/${tag.id}/starters/${branch.starterId}`,'DELETE').then(loadTags)}>×</button></span>)}<button type="button" className="text-button" onClick={async()=>{const label=window.prompt('Add a label, such as important, event, or past');if(!label?.trim())return;try{const tag=await api<{id:string}>('/tags','POST',{label});await api(`/tags/${tag.id}/starters/${branch.starterId}`,'POST');await loadTags()}catch(problem){setError((problem as Error).message)}}}>+ Add label</button></div>
    {branch.refreshError && <p className="refresh-warning" role="status"><strong>Refresh needs attention:</strong> {branch.refreshError}</p>}
    <details className="branch-manage"><summary>Manage thread</summary><form className="tracking-form branch-editor" onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('')
      try { await Promise.all([api(`/branches/${branch.id}`,'PATCH',{ status:data.get('status'),partnerId:data.get('partnerId') || null,notes:data.get('notes'),nextCheckAt:data.get('nextCheckAt') ? new Date(`${data.get('nextCheckAt')}T09:00:00.000Z`).toISOString() : null }),api(`/starters/${branch.starterId}`,'PATCH',{ title:data.get('title'),description:data.get('description') })]); await onChange() }
      catch (e) { setError((e as Error).message) } finally { setBusy(false) }
    }}>
      <label className="branch-notes">Scene label<input name="title" maxLength={300} defaultValue={branch.title}/><span className="field-help">Use whatever helps you recognize it: {branch.characterName.toLowerCase()} × partner #1 — premise.</span></label>
      <label className="branch-notes">Premise <input name="description" maxLength={20000} defaultValue={branch.description ?? ''} placeholder="Optional short note about the scene" /></label>
      <label>Status<select name="status" defaultValue={branch.status}>{REPLY_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <label>Partner<select name="partnerId" defaultValue={branch.partnerId ?? ''}><option value="">No partner</option>{options.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="branch-notes">Branch notes<textarea name="notes" maxLength={20000} defaultValue={branch.notes}/></label>
      <label>Reminder to check back<input name="nextCheckAt" type="date" defaultValue={branch.nextCheckAt?.slice(0,10) ?? ''}/><span className="field-help">Puffin includes this in browser reminders on or after the date.</span></label>
      <button disabled={busy}>{busy ? 'Saving...' : 'Save branch'}</button><button type="button" className="danger-button" disabled={busy} onClick={async()=>{if(!window.confirm('Delete this entire thread and every reply branch?'))return;try{setBusy(true);await api(`/starters/${branch.starterId}`,'DELETE');await onChange()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}}>Delete thread</button>{error && <p role="alert">{error}</p>}
    </form></details>
  </article>
}
