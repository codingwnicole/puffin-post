import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './landing-fixes.css'

// Client-error reporting: forward uncaught page errors to /api/client-errors.
// At most 5 reports per page load; rate-limited server-side as well.
let reported = 0
function reportClientError(message: string) {
  if (reported >= 5) return
  reported++
  const payload = JSON.stringify({ message, route: window.location.hash.split('?')[0] || '/', ua: navigator.userAgent })
  if (navigator.sendBeacon && navigator.sendBeacon('/api/client-errors', new Blob([payload], { type: 'application/json' }))) return
  fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => undefined)
}
window.addEventListener('error', event => { if (event.error) reportClientError(String(event.error.message || event.message)) })
window.addEventListener('unhandledrejection', event => { reportClientError(event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unknown rejection')) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
