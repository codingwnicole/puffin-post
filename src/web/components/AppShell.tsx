import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'
import { clearApiCache } from '../lib/api'
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

export default function AppShell({ page, children }: { page:AppPage; children:ReactNode }) {
  const [signingOut, setSigningOut] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [activityUnread, setActivityUnread] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const lastUserId = useRef<string | null | undefined>(undefined)
  // Ctrl/⌘K opens the command menu. Must not fire while typing in an input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (isEditableTarget(event.target)) return
        setMenuOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const shortcutKey = /Mac|iP/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
  useEffect(() => { fetch('/api/auth/session').then(async response => { setSignedIn(response.ok); if(response.ok) { const session = (await response.json().catch(() => ({}))) as { user?: { id?: string | number; name?: string } }; const userId = String(session.user?.id ?? session.user?.name ?? 'default'); if (lastUserId.current !== undefined && lastUserId.current !== userId) clearApiCache(); lastUserId.current = userId; void fetch('/api/tumblr-activity/unread-count').then(value=>value.ok?value.json():{count:0}).then(value=>setActivityUnread((value as {count?:number}).count??0)) } }).catch(() => setSignedIn(false)) }, [page])

  return <div className={`app-shell${signedIn ? '' : ' app-shell-guest'}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <header className="brand"><a href={signedIn ? '#inbox' : '/'} className="brand-home"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><path className="puffin-body" d="M13 46c0-18 10-31 25-31 10 0 17 6 17 16 0 13-11 22-26 22-7 0-12-2-16-7Z"/><path className="puffin-face" d="M30 16c12 0 20 8 20 18 0 8-7 14-16 14-10 0-17-7-17-16 0-9 5-16 13-16Z"/><path className="puffin-beak" d="M45 31c8 0 13 3 15 7-4 6-10 8-17 7l2-14Z"/><circle cx="38" cy="27" r="2.3" className="puffin-eye"/></svg></span><span>Puffin Post</span></a>{signedIn && <span className="beta-label">Private beta</span>}</header>
    {signedIn && <nav className="primary-nav" aria-label="Primary"><p className="nav-label">Workspace</p>
      {navigation.map(([item, label, icon], index) => <a key={item} href={`#${item}`} data-secondary={index > 2 || undefined} aria-current={page === item ? 'page' : undefined}><Icon name={icon}/><span>{label}{item==='activity'&&activityUnread>0?<b className="nav-unread" aria-label={`${activityUnread} unread activity items`}>{activityUnread>9?'9+':activityUnread}</b>:null}</span></a>)}
      <details className="mobile-more"><summary><Icon name="more"/><span>More</span></summary><div><a href="#activity"><Icon name="activity"/>Tumblr activity</a><a href="#tools"><Icon name="tools"/>Writing tools</a><a href="#planner"><Icon name="planner"/>Character planner</a><a href="#connections"><Icon name="connections"/>Connected accounts</a><a href="#settings"><Icon name="settings"/>Settings</a><a href="#support"><Icon name="more"/>Support & feedback</a></div></details>
      <p className="nav-note"><button type="button" className="shortcut-hint" onClick={() => setMenuOpen(true)} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" />Search / commands<kbd>{shortcutKey}</kbd></button>Track scenes, not spreadsheets.<button className="sign-out" disabled={signingOut} onClick={async () => { setSigningOut(true); clearApiCache(); await fetch('/api/auth/sign-out', { method:'POST', headers:{ origin:window.location.origin } }); window.history.replaceState(null, '', '/'); window.location.reload() }}>{signingOut ? 'Signing out.' : 'Sign out'}</button></p>
    </nav>}
    <main id="main-content" tabIndex={-1}>{signedIn && <div className="workspace-heading"><p className="eyebrow">Your writing space</p><p className="tagline">Keep every thread moving.</p></div>}{children}</main>
    {signedIn && <CommandMenu open={menuOpen} onClose={() => setMenuOpen(false)} />}
    <ToastHost />
  </div>
}
