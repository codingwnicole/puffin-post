import { useEffect, useState } from 'react'
import AppShell, { type AppPage } from './components/AppShell'
import InboxPage from './pages/InboxPage'
import StarterPage from './pages/StarterPage'
import ReplyParkingLotPage from './pages/ReplyParkingLotPage'
import ConnectionsPage from './pages/ConnectionsPage'
import CharactersPage from './pages/CharactersPage'
import SettingsPage from './pages/SettingsPage'

function pageForRoute(route: string): AppPage {
  return route.startsWith('starter/') ? 'starter' : route === 'characters' || route === 'settings' || route === 'parking-lot' || route === 'connections' ? route : 'inbox'
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1))
  const page = pageForRoute(route)
  const starterId = route.slice('starter/'.length)
  useEffect(() => {
    const navigate = () => setRoute(window.location.hash.slice(1))
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  return (
    <AppShell page={page}>
      {page === 'inbox' ? <InboxPage /> : page === 'parking-lot' ? <ReplyParkingLotPage /> : page === 'connections' ? <ConnectionsPage /> : page === 'characters' ? <CharactersPage /> : page === 'settings' ? <SettingsPage /> : page === 'starter' ? <StarterPage key={starterId} id={starterId} /> : (
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
