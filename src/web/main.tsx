import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyThemePreference, readThemePreference } from './lib/theme'
// Self-hosted fonts (OFL): the Worker CSP allows fonts from 'self' only. Vite bundles the woff2 files; unicode-range
// subsets mean the browser fetches only the scripts and faces a page actually uses.
import '@fontsource/young-serif/400.css'
import '@fontsource-variable/figtree/wght.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import './styles.css'
import './landing-fixes.css'
import './redesign.css'

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

// Saved light/dark and desk theme apply on every page, not only once Settings is opened.
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
const syncTheme = () => applyThemePreference(readThemePreference(), systemDark.matches)
syncTheme()
systemDark.addEventListener('change', syncTheme) // "Use system" follows the OS live

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
