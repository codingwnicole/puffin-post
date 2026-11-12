import type { ReactNode } from 'react'
import Icon from './Icon'

export type AppPage = 'inbox' | 'characters' | 'settings' | 'parking-lot' | 'connections' | 'starter'

const navigation = [
  ['inbox', 'Inbox', 'inbox'], ['parking-lot', 'Parking', 'parking'], ['characters', 'Characters', 'characters'],
  ['connections', 'Connections', 'connections'], ['settings', 'Settings', 'settings'],
] as const

export default function AppShell({ page, children }: { page: AppPage; children: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <header className="brand"><a href="#inbox" className="brand-home"><span className="brand-mark" aria-hidden="true">t</span><span>Threadums</span></a><span className="beta-label">Private beta</span></header>
    <nav className="primary-nav" aria-label="Primary"><p className="nav-label">Workspace</p>
      {navigation.map(([item,label,icon], index) => <a key={item} href={`#${item}`} data-secondary={index > 2 || undefined} aria-current={page === item ? 'page' : undefined}><Icon name={icon}/><span>{label}</span></a>)}
      <details className="mobile-more"><summary role="button"><Icon name="more"/><span>More</span></summary><div><a href="#connections"><Icon name="connections"/>Connections</a><a href="#settings"><Icon name="settings"/>Settings</a></div></details>
      <p className="nav-note">Track scenes, not spreadsheets.</p>
    </nav>
    <main id="main-content" tabIndex={-1}><div className="workspace-heading"><p className="eyebrow">Your writing space</p><p className="tagline">Keep every thread moving.</p></div>{children}</main>
  </div>
}
