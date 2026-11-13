import { useEffect, useState } from 'react'
import type { Starter } from '../../db/repositories/starters'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, type TrackingOptions } from '../lib/api'
import StarterBranches from '../components/StarterBranches'

export default function StarterPage({ id }: { id:string }) {
  const [detail,setDetail] = useState<{ starter:Starter; branches:InboxBranch[] }>()
  const [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] }), [error,setError] = useState('')
  async function reload() { setDetail(await api(`/starters/${encodeURIComponent(id)}`)) }
  useEffect(() => {
    setDetail(undefined); setError('')
    Promise.all([api<{ starter:Starter; branches:InboxBranch[] }>(`/starters/${encodeURIComponent(id)}`),api<TrackingOptions>('/starters/options')])
      .then(([detail,options]) => { setDetail(detail); setOptions(options) }).catch(e => setError(e.message))
  },[id])
  return <section aria-labelledby="starter-title"><a href="#inbox">Back to Inbox</a>
    <h2 className="page-heading" id="starter-title">{detail?.starter.title ?? 'Starter'}</h2>
    {error && <p role="alert">{error}</p>}
    {detail && <><div className="actions"><p>{options.characters.find(c => c.id === detail.starter.characterId)?.name}</p><button className="danger-button" onClick={async()=>{if(!window.confirm('Delete this whole thread and every reply branch permanently?'))return;try{await api(`/starters/${id}`,'DELETE');window.location.hash='inbox'}catch(problem){setError((problem as Error).message)}}}>Delete thread</button></div>
      <p className="preserve-lines">{detail.starter.description}</p><p>Tumblr: {detail.starter.rootBlogId} · Post {detail.starter.rootPostId}</p>
      <StarterBranches starterId={id} branches={detail.branches} options={options} reload={reload} /></>}
  </section>
}
