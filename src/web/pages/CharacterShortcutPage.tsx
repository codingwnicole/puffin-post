import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { initialsFor } from '../components/InitialsAvatar'

type ArchivedCharacter = { id: string; name: string; color: string | null; notes: string | null; iconObjectKey: string | null; createdAt: string; rpGroupNames: string[]; threadCount: number }
type InboxBranch = { id: string; title: string; description: string | null; status: string; characterId: string; lastActivityAt: string | null; notes: string | null }
type Quicklink = { id: string; label: string; url: string }

export default function CharacterShortcutPage({ id }: { id: string }) {
  const [character, setCharacter] = useState<ArchivedCharacter | null>(null)
  const [branches, setBranches] = useState<InboxBranch[]>([])
  const [quicklinks, setQuicklinks] = useState<Quicklink[]>([])
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    api<ArchivedCharacter[]>('/characters/archived')
      .then(rows => setCharacter(rows.find(r => r.id === id) ?? null))
      .catch(problem => setError(problem.message))
    api<{ branches: InboxBranch[] }>('/inbox?characterId=' + id)
      .then(data => setBranches(data.branches))
      .catch(() => {})
    api<Quicklink[]>('/characters/' + id + '/quicklinks')
      .then(setQuicklinks)
      .catch(() => {})
  }, [id])

  async function restore() {
    setRestoring(true)
    try {
      await api('/characters/' + id + '/restore', 'POST')
      window.location.hash = 'planner'
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setRestoring(false)
    }
  }

  if (error) return <section aria-labelledby="shortcut-title"><h2 id="shortcut-title" className="page-heading">Character</h2><p role="alert">{error}</p></section>
  if (!character) return <section aria-labelledby="shortcut-title"><h2 id="shortcut-title" className="page-heading">Character</h2><p>Loading…</p></section>

  return (
    <section aria-labelledby="shortcut-title">
      <div className="shortcut-header">
        <img className="shortcut-avatar" alt="" hidden={!character.iconObjectKey} src={character.iconObjectKey ? '/api/characters/' + character.id + '/icon?v=' + character.iconObjectKey : undefined} onError={event => event.currentTarget.classList.add('avatar-fallback')} data-initials={initialsFor(character.name)} />
        <div>
          <h2 id="shortcut-title" className="page-heading">{character.name}</h2>
          <p className="page-description">
            {character.rpGroupNames.length > 0 ? character.rpGroupNames.join(' · ') : 'No RP group'}
            {' · '}{character.threadCount} thread{character.threadCount === 1 ? '' : 's'} preserved
          </p>
        </div>
        <button type="button" className="secondary-button" disabled={restoring} onClick={() => void restore()}>
          {restoring ? 'Restoring…' : 'Restore to cast'}
        </button>
      </div>

      <h3>Threads</h3>
      {branches.length > 0 ? (
        <ul className="shortcut-branches">
          {branches.map(b => (
            <li key={b.id}>
              <a href={'#starter/' + b.id}>{b.title}</a>
              {b.description && <span className="shortcut-branch-desc"> — {b.description.slice(0, 80)}{b.description.length > 80 ? '…' : ''}</span>}
              <span className={'shortcut-branch-status shortcut-branch-' + b.status.replace('turn', '')}>{b.status.replace('_turn', ' turn')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No threads found.</p>
      )}

      <h3>Saved links</h3>
      {quicklinks.length > 0 ? (
        <ul className="shortcut-quicklinks">
          {quicklinks.map(l => <li key={l.id}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></li>)}
        </ul>
      ) : (
        <p>No saved links.</p>
      )}
    </section>
  )
}
