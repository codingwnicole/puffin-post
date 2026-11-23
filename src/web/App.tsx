import { useEffect, useState, type ReactNode } from 'react'
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
import CharacterProfilePage from './pages/CharacterProfilePage'
import SupportPage from './pages/SupportPage'
import { LegalPage } from './pages/LegalPage'
import RoadmapPage from './pages/RoadmapPage'

const LEGAL_ROUTES = ['terms', 'privacy', 'cookies'] as const
type LegalRoute = (typeof LEGAL_ROUTES)[number]
function legalRouteFor(route: string): LegalRoute | null {
  return (LEGAL_ROUTES as readonly string[]).includes(route) ? (route as LegalRoute) : null
}

// Every app route lives here: the page highlighted in the nav, and what to render.
// Parameterised routes (`starter/<id>`) are keyed so changing the id remounts the page.
const PAGES: Partial<Record<AppPage, () => ReactNode>> = {
  'parking-lot': () => <ReplyParkingLotPage />,
  connections: () => <ConnectionsPage />,
  characters: () => <CharactersPage />,
  planner: () => <CharacterPlannerPage />,
  tools: () => <WritingToolsPage />,
  activity: () => <TumblrActivityPage />,
  support: () => <SupportPage />,
  roadmap: () => <RoadmapPage />,
  settings: () => <SettingsPage />,
}

function routeFor(hash: string): { page: AppPage; render: () => ReactNode } {
  const [path] = hash.split('?')
  const param = (prefix: string) => path.startsWith(prefix) ? path.slice(prefix.length) : null
  const shortcutId = param('character-shortcut/'), profileId = param('character/'), starterId = param('starter/')
  if (shortcutId !== null) return { page: 'dashboard', render: () => <CharacterShortcutPage key={shortcutId} id={shortcutId} /> }
  if (profileId !== null) return { page: 'characters', render: () => <CharacterProfilePage key={profileId} id={profileId} /> }
  if (starterId !== null) return { page: 'starter', render: () => <StarterPage key={starterId} id={starterId} /> }
  const page = path as AppPage
  const render = PAGES[page]
  // Unknown routes (including '', 'dashboard', the old 'inbox', and in-page anchors such as 'quick-add') show the Dashboard.
  return render ? { page, render } : { page: 'dashboard', render: () => <InboxPage /> }
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1))
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
  const legalRoute = legalRouteFor(route)
  if (legalRoute) return <LegalPage doc={legalRoute} />
  const { page, render } = routeFor(route)
  return <AppShell page={page}>{render()}</AppShell>
}
