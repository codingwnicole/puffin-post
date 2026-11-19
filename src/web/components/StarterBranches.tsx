import { useState } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, type TrackingOptions } from '../lib/api'
import BranchRow from './BranchRow'

export default function StarterBranches({ starterId,branches,options,reload }: { starterId:string; branches:InboxBranch[]; options:TrackingOptions; reload:() => Promise<void> }) {
  const [error,setError] = useState(''), [busy,setBusy] = useState(false)
  return <>
    <h3>Writing partners ({branches.length})</h3>
    {branches.map(branch => <BranchRow key={`${branch.id}:${branch.status}:${branch.notes}:${branch.partnerId}`} branch={branch} options={options} onChange={reload} />)}
    <form className="tracking-form tracking-card" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
      setBusy(true); setError('')
      try { await api(`/starters/${starterId}/branches`,'POST',{ partnerId:data.get('partnerId') || null,notes:data.get('notes') }); form.reset(); await reload() }
      catch(e) { setError((e as Error).message) } finally { setBusy(false) }
    }}>
      <h3>Add a writing partner</h3>
      <label>Partner<select name="partnerId"><option value="">No partner yet</option>{options.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Branch notes<textarea name="notes" maxLength={20000} /></label>
      <button disabled={busy}>Add branch</button>{error && <p role="alert">{error}</p>}
    </form>
  </>
}
