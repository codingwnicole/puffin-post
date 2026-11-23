import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'
import { api, clearApiCache, prefetchNav } from '../lib/api'
import { isEditableTarget } from '../lib/shortcuts'
import CommandMenu from './CommandMenu'
import ToastHost from './ToastHost'
import OnboardingTour from './OnboardingTour'

export type AppPage = 'dashboard' | 'characters' | 'planner' | 'settings' | 'parking-lot' | 'connections' | 'tools' | 'activity' | 'support' | 'roadmap' | 'starter'

const navigation = [
  ['dashboard', 'Dashboard', 'inbox'],
  ['parking-lot', 'Parking', 'parking'],
  ['characters', 'Characters', 'characters'],
  ['activity', 'Tumblr activity', 'activity'],
  ['tools', 'Writing tools', 'tools'],
  ['planner', 'Character planner', 'planner'],
  ['connections', 'Connected accounts', 'connections'],
  ['settings', 'Settings', 'settings'],
  ['support', 'Support & feedback', 'more'],
  ['roadmap', 'Site roadmap', 'planner'],
] as const

// Swipe-to-close for the phone bottom sheet: pointer-down on the grabber, follow the
// finger with a direct translateY (no transition while dragging), close past 30% of the
// height or on a fast down-flick, else snap back. Starts only on a deliberate vertical
// drag (>8px, more vertical than horizontal) so in-sheet scrolling is never blocked.
// A sheet holding unsaved text snaps back and tells the user instead of closing.
function useSwipeToClose(sheetRef: React.RefObject<HTMLDivElement | null>, open: boolean, close: () => void, hasUnsaved: () => boolean) {
  const [offset, setOffsetState] = useState(0)
  const [notice, setNotice] = useState('')
  const offsetRef = useRef(0)
  const setOffset = (value: number) => { offsetRef.current = value; setOffsetState(value) }
  // The sheet only renders while open, so attach on open; the ref is set by then.
  useEffect(() => {
    const sheet = sheetRef.current
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
  }, [sheetRef, open, close, hasUnsaved])
  return { offset, notice, setNotice, clearNotice: () => setNotice('') }
}

export default function AppShell({ page, children }: { page:AppPage; children:ReactNode }) {
  const [signingOut, setSigningOut] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [activityUnread, setActivityUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  // Keep this menu React-owned. Native <details> and React state were fighting over its open state
  // on touch browsers, which made the sheet flash and immediately close.
  const closeMore = useCallback(() => setMenuOpen(false), [])
  const [commandOpen, setCommandOpen] = useState(false)
  const [tourOpen,setTourOpen]=useState(()=>{try{return sessionStorage.getItem('rptb-tour-open')==='1'}catch{return false}})
  // Swipe-to-close: hasUnsaved reads the sheet's editable fields for unsent text.
  const sheetRef = useRef<HTMLDivElement>(null)
  const hasUnsaved = useCallback(() => Array.from(sheetRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea') ?? []).some(field => field.value.trim().length > 0), [])
  const { offset, notice, setNotice, clearNotice } = useSwipeToClose(sheetRef, menuOpen, closeMore, hasUnsaved)
  // The sheet's quick note used to be thrown away. Enter now parks it as a note in the Parking Lot.
  const [savingNote, setSavingNote] = useState(false)
  const saveQuickNote = (field: HTMLInputElement) => {
    const text = field.value.trim()
    if (!text || savingNote) return
    setSavingNote(true)
    api('/reply-drafts', 'POST', { title: text.slice(0, 300), notes: text, purpose: 'note' })
      .then(() => { field.value = ''; setNotice('Saved to your Parking Lot') })
      .catch(problem => setNotice((problem as Error).message))
      .finally(() => setSavingNote(false))
  }
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
  useEffect(()=>{const open=()=>{try{sessionStorage.setItem('rptb-tour-open','1');sessionStorage.setItem('rptb-tour-step','0')}catch{}setTourOpen(true)};window.addEventListener('rptb:open-onboarding',open);return()=>window.removeEventListener('rptb:open-onboarding',open)},[])
  const shortcutKey = /Mac|iP/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline) }
  }, [])
  useEffect(() => {
    fetch('/api/auth/session').then(async response => {
      if (response.status === 401 || response.status === 403) {
        setSignedIn(false)
        document.querySelector('meta[name="robots"]')?.remove()
      } else if (response.ok) {
        setSignedIn(true)
        const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
          ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }))
        robots.content = 'noindex, nofollow'
      }
      if (response.ok) {
        const session = (await response.json().catch(() => ({}))) as { userId?: string; workspaceId?: string }
        const identity = String(session.userId ?? 'default') + ':' + String(session.workspaceId ?? 'default')
        if (lastIdentity.current !== undefined && lastIdentity.current !== identity) clearApiCache()
        lastIdentity.current = identity
        void fetch('/api/tumblr-activity/unread-count').then(value => value.ok ? value.json() : { count: 0 }).then(value => setActivityUnread((value as { count?: number }).count ?? 0))
      }
    }).catch(() => undefined)
  }, [page])

  return <div className={`app-shell${signedIn ? '' : ' app-shell-guest'}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <header className="brand"><a href={signedIn ? '#dashboard' : '/'} className="brand-home"><span className="brand-mark" aria-hidden="true">RP</span><span>RP Thread Buddy</span></a>{signedIn && <span className="beta-label">Private beta</span>}</header>
    {signedIn && <nav className="primary-nav" aria-label="Primary"><p className="nav-label">Workspace</p>
      {navigation.map(([item, label, icon], index) => <a key={item} href={`#${item}`} data-secondary={index > 2 || undefined} aria-current={page === item ? 'page' : undefined} onPointerEnter={navPrefetch(item)} onFocus={navPrefetch(item)}><Icon name={icon}/><span>{label}{item==='activity'&&activityUnread>0?<b className="nav-unread" aria-label={`${activityUnread} unread activity items`}>{activityUnread>9?'9+':activityUnread}</b>:null}</span></a>)}
      <div className={`mobile-more${menuOpen ? ' is-open' : ''}`}><button type="button" className="mobile-more-toggle" aria-expanded={menuOpen} aria-controls="mobile-more-menu" onClick={() => setMenuOpen(open => !open)}><Icon name="more"/><span>More</span></button>{menuOpen && <div id="mobile-more-menu" ref={sheetRef} className="mobile-more-menu" style={offset ? { transform: `translateY(${offset}px)`, transition: 'none' } : undefined}><span className="sheet-grabber" aria-hidden="true"></span><div className="sheet-menu-head"><span>More</span><button type="button" className="sheet-close" onClick={() => { closeMore(); clearNotice() }}>Close</button></div>{notice && <p className="sheet-notice" role="status">{notice}</p>}<label className="sheet-note-label"><span>Note</span><input className="sheet-note" type="text" placeholder="Quick note (Enter saves it)" aria-label="Quick note" enterKeyHint="done" maxLength={20000} readOnly={savingNote} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveQuickNote(event.currentTarget) } }} /></label><a href="#activity" onClick={() => { clearNotice(); closeMore() }}><Icon name="activity"/>Tumblr activity</a><a href="#tools" onClick={() => { clearNotice(); closeMore() }}><Icon name="tools"/>Writing tools</a><a href="#planner" onClick={() => { clearNotice(); closeMore() }}><Icon name="planner"/>Character planner</a><a href="#connections" onClick={() => { clearNotice(); closeMore() }}><Icon name="connections"/>Connected accounts</a><a href="#settings" onClick={() => { clearNotice(); closeMore() }}><Icon name="settings"/>Settings</a><a href="#support" onClick={() => { clearNotice(); closeMore() }}><Icon name="more"/>Support &amp; feedback</a><a href="#roadmap" onClick={() => { clearNotice(); closeMore() }}><Icon name="planner"/>Site roadmap</a></div>}</div>
      <p className="nav-note"><button type="button" className="shortcut-hint" onClick={() => setCommandOpen(true)} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" />Search / commands<kbd>{shortcutKey}</kbd></button>Track scenes, not spreadsheets.<button className="sign-out" disabled={signingOut} onClick={async () => { setSigningOut(true); clearApiCache(); await fetch('/api/auth/sign-out', { method:'POST', headers:{ origin:window.location.origin } }); window.history.replaceState(null, '', '/'); window.location.reload() }}>{signingOut ? 'Signing out.' : 'Sign out'}</button><span className="nav-legal"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a></span></p>
    </nav>}
    <main id="main-content" tabIndex={-1}>{offline && <p className="offline-banner" role="status">You're offline. Changes can't be saved until you're back online.</p>}{children}</main>
    {signedIn && <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />}
    {signedIn&&tourOpen&&<OnboardingTour open onClose={()=>setTourOpen(false)}/>}
    <ToastHost />
  </div>
}
