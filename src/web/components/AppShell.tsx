import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'
import { clearApiCache, prefetchNav } from '../lib/api'
import { isEditableTarget } from '../lib/shortcuts'
import CommandMenu from './CommandMenu'
import ToastHost from './ToastHost'

export type AppPage = 'inbox' | 'characters' | 'planner' | 'settings' | 'parking-lot' | 'connections' | 'tools' | 'activity' | 'support' | 'starter'

const navigation = [
  ['inbox', 'Inbox', 'inbox'],
  ['parking-lot', 'Parking', 'parking'],
  ['characters', 'Characters', 'characters'],
  ['activity', 'Tumblr activity', 'activity'],
  ['tools', 'Writing tools', 'tools'],
  ['planner', 'Character planner', 'planner'],
  ['connections', 'Connected accounts', 'connections'],
  ['settings', 'Settings', 'settings'],
  ['support', 'Support & feedback', 'more'],
] as const

// Swipe-to-close for the phone bottom sheet: pointer-down on the grabber, follow the
// finger with a direct translateY (no transition while dragging), close past 30% of the
// height or on a fast down-flick, else snap back. Starts only on a deliberate vertical
// drag (>8px, more vertical than horizontal) so in-sheet scrolling is never blocked.
// A sheet holding unsaved text snaps back and tells the user instead of closing.
function useSwipeToClose(open: boolean, close: () => void, hasUnsaved: () => boolean) {
  const [offset, setOffsetState] = useState(0)
  const [notice, setNotice] = useState('')
  const offsetRef = useRef(0)
  const setOffset = (value: number) => { offsetRef.current = value; setOffsetState(value) }
  // Listeners stay attached while the sheet exists: the browser opens it natively and React learns of that a
  // moment later, so waiting for `open` could miss a quick first swipe. The grabber is only reachable when open.
  useEffect(() => {
    const sheet = document.querySelector<HTMLElement>('.mobile-more-menu')
    if (!sheet) return
    let startY = 0, startX = 0, dragging = false, height = 0, lastY = 0, lastT = 0, tracking = false
    const onDown = (event: PointerEvent) => {
      const grabber = sheet.querySelector<HTMLElement>('.sheet-grabber')
      if (event.target instanceof Node && !grabber?.contains(event.target)) return
      startY = event.clientY; startX = event.clientX; dragging = true; tracking = false
      lastY = event.clientY; lastT = performance.now()
      height = sheet.getBoundingClientRect().height
      sheet.style.transition = 'none'
    }
    const onMove = (event: PointerEvent) => {
      if (!dragging) return
      const dy = event.clientY - startY, dx = event.clientX - startX
      if (!tracking) { if (dy <= 8 || Math.abs(dx) > dy) return; tracking = true }
      lastY = event.clientY; lastT = performance.now()
      setOffset(Math.max(0, dy))
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      sheet.style.transition = ''
      if (!tracking) { setOffset(0); return }
      const velocity = (lastY - startY) / Math.max(1, performance.now() - lastT)
      const past = offsetRef.current > height * .3
      const dismiss = past || (velocity > .9 && offsetRef.current > height * .15)
      if (dismiss && hasUnsaved()) { setOffset(0); setNotice('You have unsaved text'); return }
      if (dismiss) { setOffset(0); close() } else setOffset(0)
    }
    sheet.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => { sheet.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
  }, [open, close, hasUnsaved]) // re-run on open: the sheet element only exists once signed in
  return { offset, notice, clearNotice: () => setNotice('') }
}

export default function AppShell({ page, children }: { page:AppPage; children:ReactNode }) {
  const [signingOut, setSigningOut] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [activityUnread, setActivityUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  // The browser owns the native <details> toggle. React only mirrors it, otherwise a mobile tap can
  // race an old `menuOpen=false` render and close the sheet immediately.
  const moreRef = useRef<HTMLDetailsElement>(null)
  const closeMore = useCallback(() => { moreRef.current?.removeAttribute('open'); setMenuOpen(false) }, [])
  const [commandOpen, setCommandOpen] = useState(false)
  // Swipe-to-close: hasUnsaved reads the sheet's editable fields for unsent text.
  const hasUnsaved = useCallback(() => {
    const menu = document.querySelector<HTMLElement>('.mobile-more-menu')
    return Boolean(menu) && Array.from(menu!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')).some(field => field.value.trim().length > 0)
  }, [])
  const { offset, notice, clearNotice } = useSwipeToClose(menuOpen, closeMore, hasUnsaved)
  const navPrefetch = (item: string) => () => prefetchNav(item)
  const lastIdentity = useRef<string | null | undefined>(undefined)
  // Ctrl/⌘K opens the command menu. Must not fire while typing in an input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (isEditableTarget(event.target)) return
        setCommandOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const shortcutKey = /Mac|iP/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline) }
  }, [])
  useEffect(() => { fetch('/api/auth/session').then(async response => { setSignedIn(response.ok); if(response.ok) { const session = (await response.json().catch(() => ({}))) as { userId?: string; workspaceId?: string }; const identity = String(session.userId ?? 'default') + ':' + String(session.workspaceId ?? 'default'); if (lastIdentity.current !== undefined && lastIdentity.current !== identity) clearApiCache(); lastIdentity.current = identity; void fetch('/api/tumblr-activity/unread-count').then(value=>value.ok?value.json():{count:0}).then(value=>setActivityUnread((value as {count?:number}).count??0)) } }).catch(() => setSignedIn(false)) }, [page])

  return <div className={`app-shell${signedIn ? '' : ' app-shell-guest'}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <header className="brand"><a href={signedIn ? '#inbox' : '/'} className="brand-home"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><path className="puffin-body" d="M13 46c0-18 10-31 25-31 10 0 17 6 17 16 0 13-11 22-26 22-7 0-12-2-16-7Z"/><path className="puffin-face" d="M30 16c12 0 20 8 20 18 0 8-7 14-16 14-10 0-17-7-17-16 0-9 5-16 13-16Z"/><path className="puffin-beak" d="M45 31c8 0 13 3 15 7-4 6-10 8-17 7l2-14Z"/><circle cx="38" cy="27" r="2.3" className="puffin-eye"/></svg></span><span>Puffin Post</span></a>{signedIn && <span className="beta-label">Private beta</span>}</header>
    {signedIn && <nav className="primary-nav" aria-label="Primary"><p className="nav-label">Workspace</p>
      {navigation.map(([item, label, icon], index) => <a key={item} href={`#${item}`} data-secondary={index > 2 || undefined} aria-current={page === item ? 'page' : undefined} onPointerEnter={navPrefetch(item)} onFocus={navPrefetch(item)}><Icon name={icon}/><span>{label}{item==='activity'&&activityUnread>0?<b className="nav-unread" aria-label={`${activityUnread} unread activity items`}>{activityUnread>9?'9+':activityUnread}</b>:null}</span></a>)}
      <details className="mobile-more" ref={moreRef} onToggle={event => setMenuOpen(event.currentTarget.open)}><summary aria-expanded={menuOpen}><Icon name="more"/><span>More</span></summary><div className="mobile-more-menu" style={offset ? { transform: `translateY(${offset}px)`, transition: 'none' } : undefined}><span className="sheet-grabber" aria-hidden="true"></span><div className="sheet-menu-head"><span>More</span><button type="button" className="sheet-close" onClick={() => { closeMore(); clearNotice() }}>Close</button></div>{notice && <p className="sheet-notice" role="status">{notice}</p>}<label className="sheet-note-label"><span>Note</span><input className="sheet-note" type="text" placeholder="Quick note" aria-label="Quick note" /></label><a href="#activity" onClick={() => { clearNotice(); closeMore() }}><Icon name="activity"/>Tumblr activity</a><a href="#tools" onClick={() => { clearNotice(); closeMore() }}><Icon name="tools"/>Writing tools</a><a href="#planner" onClick={() => { clearNotice(); closeMore() }}><Icon name="planner"/>Character planner</a><a href="#connections" onClick={() => { clearNotice(); closeMore() }}><Icon name="connections"/>Connected accounts</a><a href="#settings" onClick={() => { clearNotice(); closeMore() }}><Icon name="settings"/>Settings</a><a href="#support" onClick={() => { clearNotice(); closeMore() }}><Icon name="more"/>Support &amp; feedback</a></div></details>
      <p className="nav-note"><button type="button" className="shortcut-hint" onClick={() => setCommandOpen(true)} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" />Search / commands<kbd>{shortcutKey}</kbd></button>Track scenes, not spreadsheets.<button className="sign-out" disabled={signingOut} onClick={async () => { setSigningOut(true); clearApiCache(); await fetch('/api/auth/sign-out', { method:'POST', headers:{ origin:window.location.origin } }); window.history.replaceState(null, '', '/'); window.location.reload() }}>{signingOut ? 'Signing out.' : 'Sign out'}</button><p className="nav-legal"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a></p></p>
    </nav>}
    <main id="main-content" tabIndex={-1}>{offline && <p className="offline-banner" role="status">You're offline. Changes can't be saved until you're back online.</p>}{children}</main>
    {signedIn && <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />}
    <ToastHost />
  </div>
}
