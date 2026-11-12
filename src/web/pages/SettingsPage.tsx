import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function SettingsPage() {
  const [message, setMessage] = useState('')
  const [settings,setSettings]=useState<any>(null), [email,setEmail]=useState('')
  const load=()=>api('/settings').then(setSettings).catch(e=>setMessage(e.message))
  useEffect(()=>{load()},[])
  return <section aria-labelledby="settings-title">
    <h2 id="settings-title" className="page-heading">Settings</h2>
    <p className="page-description">Manage your workspace and keep a copy of your tracking data.</p>
    <section className="tracking-card" aria-labelledby="export-title"><h3 id="export-title">Export your data</h3>
      <p>Download your starters and reply branches as a spreadsheet-safe CSV.</p>
      <a className="button" href="/api/export.csv" onClick={() => setMessage('Your download is starting.')}>Download CSV</a>
      {message && <p role="status">{message}</p>}
    </section>
    <section className="tracking-card"><h3>Tumblr and refreshes</h3><p>{settings?.connections?.length ?? 0} connected Tumblr account(s).</p><p>Last successful refresh: {settings?.lastSuccessfulSync ?? 'Not yet refreshed'}</p>{settings?.latestError && <p role="status">Latest refresh issue: {settings.latestError}</p>}</section>
    <section className="tracking-card"><h3>Character availability</h3>{settings?.characters?.map((character:any)=><label key={character.id}><input type="checkbox" checked={character.state === 'hiatus'} onChange={async e=>{await api(`/settings/characters/${character.id}/hiatus`,'PATCH',{hiatus:e.target.checked});load()}} /> {character.name} is on hiatus</label>)}</section>
    {settings?.role==='owner' && <section className="tracking-card"><h3>Private beta</h3><form onSubmit={async e=>{e.preventDefault();try{await api(`/workspaces/${settings.workspaceId ?? ''}/invites`,'POST',{email,kind:'beta'});setEmail('');setMessage('Invite sent.');load()}catch(error){setMessage((error as Error).message)}}}><label>Email <input value={email} onChange={e=>setEmail(e.target.value)} type="email" required /></label><button>Send beta invite</button></form>{settings.invites?.map((invite:any)=><p key={invite.id}>{invite.email} <button type="button" onClick={async()=>{const response=await fetch(`/api/workspaces/${settings.workspaceId}/invites/${invite.id}`,{method:'DELETE'}); if(!response.ok) setMessage('Could not revoke invite.'); else load()}}>Revoke</button></p>)}</section>}
    {message && <p role="status">{message}</p>}
  </section>
}
