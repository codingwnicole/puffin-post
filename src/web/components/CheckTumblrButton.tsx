import { useState } from 'react'
import { api } from '../lib/api'

/** Runs the Tumblr refresh now instead of waiting for the 30-minute check, then reloads the inbox. */
export default function CheckTumblrButton({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  async function check() {
    setBusy(true); setStatus(''); setError('')
    try {
      const result = await api<{ checked: number; failed: number }>('/refresh', 'POST')
      await onDone()
      setStatus(result.checked === 0 ? 'No connected Tumblr blogs to check.' : result.failed ? 'Checked Tumblr; some threads could not be read.' : 'Checked Tumblr just now.')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }
  return <span className="check-tumblr">
    <button type="button" className="text-action" disabled={busy} onClick={() => void check()}>{busy ? 'Checking Tumblr…' : 'Check Tumblr now'}</button>
    <span role="status" className="field-help">{status}</span>
    {error && <span role="alert" className="field-help">{error}</span>}
  </span>
}
