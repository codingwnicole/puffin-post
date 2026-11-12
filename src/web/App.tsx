import { useEffect, useState } from 'react'
import AppShell, { type AppPage } from './components/AppShell'
import InboxPage from './pages/InboxPage'
import StarterPage from './pages/StarterPage'
import ReplyParkingLotPage from './pages/ReplyParkingLotPage'

function currentPage(): AppPage {
  const hash = window.location.hash.slice(1)
  return hash.startsWith('starter/') ? 'starter' : hash === 'characters' || hash === 'settings' || hash === 'parking-lot' ? hash : 'inbox'
}

export default function App() {
  const [page, setPage] = useState(currentPage)
  useEffect(() => {
    const navigate = () => setPage(currentPage())
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  return (
    <AppShell page={page}>
      {page === 'inbox' ? <InboxPage /> : page === 'parking-lot' ? <ReplyParkingLotPage /> : page === 'starter' ? <StarterPage id={window.location.hash.slice('#starter/'.length)} /> : (
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
