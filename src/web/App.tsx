import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import AppShell, { type AppPage } from './components/AppShell'
import InboxPage from './pages/InboxPage'
import StarterPage from './pages/StarterPage'
import ReplyParkingLotPage from './pages/ReplyParkingLotPage'
import ConnectionsPage from './pages/ConnectionsPage'
import CharactersPage from './pages/CharactersPage'
import SettingsPage from './pages/SettingsPage'
import WritingToolsPage from './pages/WritingToolsPage'
import TumblrActivityPage from './pages/TumblrActivityPage'
import CharacterPlannerPage from './pages/CharacterPlannerPage'
import CharacterShortcutPage from './pages/CharacterShortcutPage'
import SupportPage from './pages/SupportPage'
import { LegalPage } from './pages/LegalPage'

const LEGAL_ROUTES = ['terms', 'privacy', 'cookies'] as const
type LegalRoute = (typeof LEGAL_ROUTES)[number]
function legalRouteFor(route: string): LegalRoute | null {
  return (LEGAL_ROUTES as readonly string[]).includes(route) ? (route as LegalRoute) : null
}

function pageForRoute(route: string): AppPage {
  if (route.startsWith('character-shortcut/')) return 'inbox'
  return route.startsWith('starter/') ? 'starter' : route === 'characters' || route === 'planner' || route === 'settings' || route === 'parking-lot' || route === 'connections' || route === 'tools' || route === 'activity' || route === 'support' ? route : 'inbox'
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1))
  const legalRoute = legalRouteFor(route)
  const page = pageForRoute(route)
  const starterId = route.slice('starter/'.length)
  const shortcutId = route.startsWith('character-shortcut/') ? route.slice('character-shortcut/'.length) : null
  useEffect(() => {
    const navigate = () => {
      const next = window.location.hash.slice(1)
      // View Transitions API: supported browsers crossfade app page swaps. Legal routes are full-page
      // documents, not app navigation, so skip the crossfade (it would keep the old page visible over
      // the legal doc).
      if (legalRouteFor(next)) { setRoute(next); return }
      document.startViewTransition ? document.startViewTransition(() => flushSync(() => setRoute(next))) : setRoute(next)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  // Legal routes are full-page documents, not app navigation: render them standalone, outside AppShell.
  if (legalRoute) return <LegalPage doc={legalRoute} />
  return (
    <AppShell page={page}>
      {shortcutId ? <CharacterShortcutPage key={shortcutId} id={shortcutId} /> : page === 'inbox' ? <InboxPage /> : page === 'parking-lot' ? <ReplyParkingLotPage /> : page === 'connections' ? <ConnectionsPage /> : page === 'characters' ? <CharactersPage /> : page === 'planner' ? <CharacterPlannerPage /> : page === 'tools' ? <WritingToolsPage /> : page === 'activity' ? <TumblrActivityPage /> : page === 'support' ? <SupportPage /> : page === 'settings' ? <SettingsPage /> : page === 'starter' ? <StarterPage key={starterId} id={starterId} /> : (
        <section aria-labelledby="page-title">
          <h2 id="page-title" className="page-heading">{page === 'settings' ? 'Settings' : 'Characters'}</h2>
          <p className="page-description">{page === 'settings'
            ? 'Choose the appearance that feels like you.'
            : 'Your cast of characters will live here. Character setup is coming soon.'}</p>
        </section>
      )}
    </AppShell>
  )
}
