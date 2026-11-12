import type { ReactNode } from 'react'
import ThemeMenu from './ThemeMenu'

export type AppPage = 'inbox' | 'characters' | 'settings' | 'parking-lot' | 'starter'

export default function AppShell({ page, children }: { page: AppPage; children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event => {
        event.preventDefault()
        document.getElementById('main-content')?.focus()
      }}>Skip to content</a>
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">t</span>
        <h1>Threadums</h1>
        <span className="beta-label">Private beta</span>
      </header>
      <nav className="primary-nav" aria-label="Primary">
        {(['inbox', 'parking-lot', 'characters', 'settings'] as const).map(item => (
          <a key={item} href={`#${item}`} aria-current={page === item ? 'page' : undefined}>
            <span aria-hidden="true">{item === 'inbox' ? '▤' : item === 'characters' ? '♧' : '⚙'}</span>
            {item === 'parking-lot' ? 'Reply Parking Lot' : item[0].toUpperCase() + item.slice(1)}
          </a>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1}>
        <div className="workspace-heading">
          <p className="eyebrow">Your writing space</p>
          <p className="tagline">Your stories, all in one place.</p>
        </div>
        {children}
        <ThemeMenu />
      </main>
    </div>
  )
}
