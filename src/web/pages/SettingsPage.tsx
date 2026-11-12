import { useState } from 'react'

export default function SettingsPage() {
  const [message, setMessage] = useState('')
  return <section aria-labelledby="settings-title">
    <h2 id="settings-title" className="page-heading">Settings</h2>
    <p className="page-description">Manage your workspace and keep a copy of your tracking data.</p>
    <section className="tracking-card" aria-labelledby="export-title"><h3 id="export-title">Export your data</h3>
      <p>Download your starters and reply branches as a spreadsheet-safe CSV.</p>
      <a className="button" href="/api/export.csv" onClick={() => setMessage('Your download is starting.')}>Download CSV</a>
      {message && <p role="status">{message}</p>}
    </section>
    <section className="tracking-card"><h3>Private beta</h3><p>Workspace owners can issue beta or shared-workspace invitations from the beta controls as they are enabled.</p></section>
  </section>
}
