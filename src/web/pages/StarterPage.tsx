import { useEffect, useState } from 'react'
import type { Starter } from '../../db/repositories/starters'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, clearDraftLocal, restoreDraftLocal, saveDraftLocal, type TrackingOptions } from '../lib/api'
import { toast, undoStarterArchive } from '../lib/toast'
import StarterBranches from '../components/StarterBranches'

export default function StarterPage({ id }: { id:string }) {
  const [detail,setDetail] = useState<{ starter:Starter; branches:InboxBranch[] }>()
  const [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] }), [error,setError] = useState('')
  const [premise,setPremise] = useState(''), [premiseBusy,setPremiseBusy] = useState(false), [premiseSaved,setPremiseSaved] = useState(false)
  async function reload() { setDetail(await api(`/starters/${encodeURIComponent(id)}`)) }
  useEffect(() => {
    setDetail(undefined); setError(''); setPremise(''); setPremiseSaved(false)
    Promise.all([api<{ starter:Starter; branches:InboxBranch[] }>(`/starters/${encodeURIComponent(id)}`),api<TrackingOptions>('/starters/options')])
      .then(([detail,options]) => {
        setDetail(detail); setOptions(options)
        const kept = restoreDraftLocal(`premise:${id}`)
        const saved = detail.starter.premise || detail.starter.description || ''
        setPremise(kept !== null && kept !== saved ? kept : saved)
      }).catch(e => setError(e.message))
  },[id])
  async function savePremise() {
    try {
      setPremiseBusy(true); setError('')
      await api(`/starters/${id}/premise`, 'PATCH', { premise })
      clearDraftLocal(`premise:${id}`)
      setDetail(current => current ? { ...current, starter:{ ...current.starter, premise, description:premise } } : current)
      setPremiseSaved(true); window.setTimeout(() => setPremiseSaved(false), 2500)
    } catch (problem) { setError((problem as Error).message) } finally { setPremiseBusy(false) }
  }
  const [archiveBusy,setArchiveBusy] = useState(false)
  async function toggleArchive() {
    const starter = detail?.starter
    if (!starter) return
    const wasArchived = Boolean(starter.archived)
    setError('')
    // Optimistic: flip the archived state now so the Archive/Restore button, the
    // status note, and the inbox all update instantly. A background revalidate
    // confirms it; a failed write rolls back and surfaces an alert.
    setDetail(current => current ? { ...current, starter: { ...current.starter, archived: wasArchived ? 0 : 1 } } : current)
    setArchiveBusy(true)
    try {
      if (wasArchived) { await api(`/starters/${id}/restore`, 'POST') }
      else { await api(`/starters/${id}/archive`, 'POST'); toast(`Archived “${starter.title}”.`, undoStarterArchive(id)) }
      await reload()
    } catch (problem) {
      setDetail(current => current ? { ...current, starter: { ...current.starter, archived: wasArchived ? 1 : 0 } } : current)
      setError((problem as Error).message)
    } finally { setArchiveBusy(false) }
  }
  const latestReply = detail?.branches.reduce<InboxBranch | undefined>((latest, branch) => (!latest || (branch.lastActivityAt ?? '').localeCompare(latest.lastActivityAt ?? '') > 0) ? branch : latest, undefined)
  return <section aria-labelledby="starter-title"><a href="#inbox">Back to Inbox</a>
    <h1 className="page-heading" id="starter-title" style={{ viewTransitionName: `starter-${id}` }}>{detail?.starter.title ?? 'Starter'}</h1>
    {error && <p role="alert">{error}</p>}
    {detail && <><div className="actions starter-actions"><p>{options.characters.find(c => c.id === detail.starter.characterId)?.name}</p>
      {detail.starter.rootBlogId !== 'manual' && <a className="button secondary-button" href={detail.starter.postUrl} target="_blank" rel="noreferrer noopener">Open on Tumblr</a>}
      <button className="secondary-button" onClick={toggleArchive} disabled={premiseBusy || archiveBusy}>{detail.starter.archived ? 'Restore thread' : 'Archive thread'}</button>
      <button className="danger-button" onClick={async()=>{if(!window.confirm('Permanently delete this whole thread and every reply branch? This cannot be undone. If you just want it out of your inbox, Archive thread instead.'))return;try{await api(`/starters/${id}`,'DELETE');window.location.hash='inbox'}catch(problem){setError((problem as Error).message)}}}>Delete thread</button></div>
      {Boolean(detail.starter.archived) && <p className="field-help" role="status">This thread is archived. It is excluded from inbox counts and refreshes until you restore it.</p>}
      <div className="tracking-card starter-premise"><label className="eyebrow" htmlFor="scene-summary">Scene summary</label><textarea id="scene-summary" rows={5} value={premise} onChange={e=>{ setPremise(e.target.value); saveDraftLocal(`premise:${id}`, e.target.value) }} placeholder="What is this scene about? Thread Buddy fills this in from the post; edit it freely. Sync never changes it."></textarea><div className="actions"><button onClick={savePremise} disabled={premiseBusy || premise === (detail.starter.premise || detail.starter.description || '')}>{premiseBusy ? 'Saving…' : 'Save summary'}</button>{premiseSaved && <span role="status">Summary saved</span>}</div></div>
      {detail.starter.rootBlogId !== 'manual' && <div className="tracking-card starter-latest"><p className="eyebrow">Latest reply · from Tumblr</p>{latestReply?.lastActivityAt ? <div className="space-y-2"><p className="preserve-lines">Last activity {new Date(latestReply.lastActivityAt).toLocaleString()}{latestReply.lastPoster ? ` · by ${latestReply.lastPoster}` : ''}</p>{latestReply.latestReplyExcerpt ? <p className="preserve-lines">{latestReply.latestReplyExcerpt}</p> : null}</div> : <p className="field-help">No Tumblr reply captured for this thread yet.</p>}</div>}
      <StarterBranches starterId={id} branches={detail.branches} options={options} reload={reload} /></>}
  </section>
}
