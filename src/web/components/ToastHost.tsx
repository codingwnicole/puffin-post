import { useEffect, useRef, useState } from 'react'
import { dismissToast, useUndoToast } from '../lib/toast'

// Single toast host rendered once in AppShell. Shows the current toast with an
// Undo button for ~6s. Undo runs the server restore; on failure it says so.
export default function ToastHost() {
  const toast = useUndoToast()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const currentId = toast?.id

  useEffect(() => {
    if (currentId === undefined) return
    setBusy(false); setFailed(false)
    timerRef.current = window.setTimeout(dismissToast, 6000)
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
  }, [currentId])

  if (!toast) return null
  const active = toast

  async function onUndo() {
    if (busy) return
    setBusy(true)
    try { await active.restore(); dismissToast() }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }

  return (
    <div className="toast toast-undo" role="status" aria-live="polite">
      <span className="toast-message">{failed ? 'Couldn’t undo. ' : ''}{active.message}</span>
      <button className="toast-action" onClick={() => void onUndo()} disabled={busy}>
        {busy ? 'Restoring…' : 'Undo'}
      </button>
    </div>
  )
}
