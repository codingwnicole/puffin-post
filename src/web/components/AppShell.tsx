import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Icon from './Icon'
import { api, clearApiCache, prefetchNav } from '../lib/api'
import { isEditableTarget } from '../lib/shortcuts'
import CommandMenu from './CommandMenu'
import ToastHost from './ToastHost'
import DeskRail, { DeskBar } from './DeskRail'
import OnboardingTour from './OnboardingTour'

export type AppPage = 'dashboard' | 'characters' | 'planner' | 'settings' | 'parking-lot' | 'connections' | 'tools' | 'activity' | 'support' | 'roadmap' | 'starter'

type NavItem = readonly [page: AppPage, label: string, icon: 'inbox' | 'parking' | 'characters' | 'activity' | 'tools' | 'planner' | 'connections' | 'settings' | 'roadmap' | 'support']
// Desktop groups the pages into folder drawers; the phone tab bar shows `tabs`, the rest live in the More sheet.
const drawers: readonly { key: string; label: string; tint: string; items: readonly NavItem[] }[] = [
  { key: 'threads', label: 'Threads', tint: 'var(--turn-t)', items: [['dashboard', 'Dashboard', 'inbox'], ['parking-lot', 'Parking lot', 'parking'], ['activity', 'Tumblr activity', 'activity']] },
  { key: 'cast', label: 'Cast', tint: 'var(--peach-t)', items: [['characters', 'Characters', 'characters'], ['planner', 'Character planner', 'planner']] },
  { key: 'desk', label: 'Desk', tint: 'var(--starter-t)', items: [['tools', 'Writing tools', 'tools']] },
  { key: 'account', label: 'Account', tint: 'var(--wait-t)', items: [['connections', 'Connected accounts', 'connections'], ['settings', 'Settings', 'settings'], ['roadmap', 'Site roadmap', 'roadmap'], ['support', 'Support & feedback', 'support']] },
]
const tabs: readonly NavItem[] = [['dashboard', 'Dashboard', 'inbox'], ['parking-lot', 'Parking', 'parking'], ['characters', 'Characters', 'characters'], ['tools', 'Tools', 'tools']]
const moreLinks: readonly NavItem[] = [['activity', 'Tumblr activity', 'activity'], ['planner', 'Character planner', 'planner'], ['connections', 'Connected accounts', 'connections'], ['settings', 'Settings', 'settings'], ['roadmap', 'Site roadmap', 'roadmap'], ['support', 'Support & feedback', 'support']]
const drawerKey = 'rptb-nav-drawers'
function readDrawers(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(drawerKey) ?? '{}') as Record<string, boolean> } catch { return {} } }

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
      const grabber = sheet.querySelector<HTMLElement>('.rd-grabber')
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
  const [openDrawers, setOpenDrawers] = useState(readDrawers)
  const toggleDrawer = (key: string) => setOpenDrawers(current => {
    const next = { ...current, [key]: current[key] === false }
    try { localStorage.setItem(drawerKey, JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
    return next
  })
  const signOut = async () => { setSigningOut(true); clearApiCache(); await fetch('/api/auth/sign-out', { method:'POST', headers:{ origin:window.location.origin } }); window.history.replaceState(null, '', '/'); window.location.reload() }
  const closeSheet = () => { clearNotice(); closeMore() }
  const unreadBadge = activityUnread > 0 ? <b className="rd-count" aria-label={`${activityUnread} unread activity items`}>{activityUnread > 9 ? '9+' : activityUnread}</b> : null
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

  const search = <button type="button" className="rd-search" aria-label="Search / commands" onClick={() => setCommandOpen(true)} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" /><span>Search / commands</span><kbd>{shortcutKey}</kbd></button>
  const brand = <div className="rd-brand"><a href={signedIn ? '#dashboard' : '/'} className="rd-brand-home" aria-label="RP Thread Buddy"><span className="rd-brand-mark" aria-hidden="true">RP</span><span className="rd-brand-name">RP Thread Buddy</span></a>{signedIn && <span className="rd-beta">Private beta</span>}</div>

  return <div className={`rd-shell${signedIn ? '' : ' rd-guest'}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    {!signedIn && <header className="rd-guest-brand">{brand}</header>}
    {signedIn && <nav className="rd-side" aria-label="Primary">
      {brand}
      {search}
      {drawers.map(drawer => {
        const open = openDrawers[drawer.key] !== false
        return <div key={drawer.key} className="rd-drawer" data-open={open} style={{ '--dc': drawer.tint } as CSSProperties}>
          <button type="button" className="rd-drawer-tab" aria-expanded={open} aria-controls={`nav-${drawer.key}`} title={drawer.label} onClick={() => toggleDrawer(drawer.key)}><i aria-hidden="true" /><span>{drawer.label}</span><span className="rd-chev"><Icon name="chevron" /></span></button>
          <div className="rd-drawer-list" id={`nav-${drawer.key}`}><div>
            {drawer.items.map(([item, label, icon], index) => <a key={item} className="rd-link" style={{ '--i': index } as CSSProperties} href={`#${item}`} title={label} tabIndex={open ? undefined : -1} aria-current={page === item ? 'page' : undefined} onPointerEnter={navPrefetch(item)} onFocus={navPrefetch(item)}><Icon name={icon} /><span>{label}</span>{item === 'activity' && unreadBadge}</a>)}
          </div></div>
        </div>
      })}
      <div className="rd-foot">
        <span>Track scenes, not spreadsheets.</span>
        <span><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a></span>
        <span>Icons by <a href="https://www.svgrepo.com/collection/chikin-variety-glyph-icons/" target="_blank" rel="noopener noreferrer">chikin icons</a>, <a href="https://www.svgrepo.com/collection/jumpicon-glyph-icons/" target="_blank" rel="noopener noreferrer">Ayub Irawan</a> and <a href="https://www.svgrepo.com/collection/communication-glyphs-icons/" target="_blank" rel="noopener noreferrer">wishforge.games</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>, modified)</span>
        <button type="button" className="rd-signout" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </nav>}
    {signedIn && <header className="rd-topbar">{brand}{search}</header>}
    <div className="rd-sheet-wrap">
      <main id="main-content" tabIndex={-1}>{offline && <p className="offline-banner" role="status">You're offline. Changes can't be saved until you're back online.</p>}{children}</main>
    </div>
    {signedIn && <DeskRail />}
    {signedIn && <DeskBar />}
    {signedIn && <nav className="rd-tabbar" aria-label="Primary (phone)">
      {tabs.map(([item, label, icon]) => <a key={item} className="rd-tab" href={`#${item}`} aria-current={page === item ? 'page' : undefined} onPointerEnter={navPrefetch(item)}><Icon name={icon} />{label}</a>)}
      <div className={`rd-more${menuOpen ? ' is-open' : ''}`} style={{ display: 'contents' }}>
        <button type="button" className="rd-tab rd-more-toggle" aria-expanded={menuOpen} aria-controls="mobile-more-menu" onClick={() => setMenuOpen(open => !open)}><Icon name="more" />More{activityUnread > 0 && <b className="rd-count" aria-hidden="true">{activityUnread > 9 ? '9+' : activityUnread}</b>}</button>
        {menuOpen && <>
          <div className="rd-more-backdrop" aria-hidden="true" onClick={closeSheet} />
          <div id="mobile-more-menu" ref={sheetRef} className="rd-more-sheet" role="dialog" aria-label="More" style={offset ? { transform: `translateY(${offset}px)`, transition: 'none' } : undefined}>
            <span className="rd-grabber" aria-hidden="true"></span>
            <div className="rd-sheet-head"><span>More</span><button type="button" className="rd-sheet-close" onClick={closeSheet}>Close</button></div>
            {notice && <p className="rd-sheet-notice" role="status">{notice}</p>}
            <label className="rd-sheet-note-label"><span>Note</span><input className="rd-sheet-note" type="text" placeholder="Quick note (Enter saves it)" aria-label="Quick note" enterKeyHint="done" maxLength={20000} readOnly={savingNote} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveQuickNote(event.currentTarget) } }} /></label>
            <div className="rd-sheet-links">
              {moreLinks.map(([item, label, icon]) => <a key={item} className="rd-link" href={`#${item}`} aria-current={page === item ? 'page' : undefined} onClick={closeSheet}><Icon name={icon} /><span>{label}</span>{item === 'activity' && unreadBadge}</a>)}
              <button type="button" className="rd-link" onClick={() => { closeSheet(); setCommandOpen(true) }}><Icon name="search" /><span>Search / commands</span></button>
              <button type="button" className="rd-link" disabled={signingOut} onClick={signOut}><Icon name="more" /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span></button>
            </div>
          </div>
        </>}
      </div>
    </nav>}
    {signedIn && <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />}
    {signedIn&&tourOpen&&<OnboardingTour open onClose={()=>setTourOpen(false)}/>}
    <ToastHost />
  </div>
}
