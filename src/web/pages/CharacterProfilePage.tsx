import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import { api, staleGet } from '../lib/api'
import TradingCard, { emptyCard, THEMES, type CardProfile, type CardStats } from '../components/TradingCard'
import CardEditor from '../components/CardEditor'
import { parsePlaylist } from '../../shared/embeds'
import { fitImage, IMAGE_ACCEPT, IMAGE_HINT } from '../lib/uploads'

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null; card?: CardProfile | null }
type Group = { id: string; name: string; characterIds: string[] }
type MoodboardItem = { id: string; kind: 'image' | 'pin'; pinId: string | null; position: number }

const SERVICE_LABEL = { spotify: 'Spotify', youtube: 'YouTube', apple: 'Apple Music' } as const

export default function CharacterProfilePage({ id }: { id: string }) {
  const [rows, setRows] = useState<Character[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [branches, setBranches] = useState<{ characterId: string; status: string }[]>([])
  const [items, setItems] = useState<MoodboardItem[]>([])
  const [card, setCard] = useState<CardProfile | null>(null)
  const [moodUrls, setMoodUrls] = useState<string[]>([])
  const [portraitVersion, setPortraitVersion] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingCard, setEditingCard] = useState(false)
  const [pinUrl, setPinUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // One reload re-reads everything the page owns: the cast (to find this character), its RP
  // sections, the inbox threads behind the card stats, the card, and the moodboard tiles.
  const reload = async () => {
    try {
      const [characters, groupRows, inbox, board] = await Promise.all([
        staleGet<Character[]>('/characters'),
        staleGet<Group[]>('/rp-groups'),
        staleGet<{ branches: { characterId: string; status: string }[] }>('/inbox'),
        api<MoodboardItem[]>(`/characters/${id}/moodboard`).catch(() => [] as MoodboardItem[]),
      ])
      setRows(characters); setGroups(groupRows); setBranches(inbox.branches ?? [])
      const boardItems = Array.isArray(board) ? board : (board as { items?: MoodboardItem[] }).items ?? []
      setItems(boardItems)
      setMoodUrls(boardItems.filter(item => item.kind === 'image').map(item => `/api/characters/${id}/moodboard/${item.id}/image`))
      const match = characters.find(c => c.id === id)
      setCard(match?.card ?? emptyCard())
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Something went wrong') }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [id])

  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    try { await run(); setError(null); await reload() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Something went wrong') }
    finally { setBusy(false) }
  }

  const move = (index: number, dir: -1 | 1) => {
    if (!items[index + dir] || busy) return
    // PUT /order takes the full sequence; only these two tiles change.
    void act(async () => {
      const order = items.map(item => item.id)
      ;[order[index], order[index + dir]] = [order[index + dir], order[index]]
      await api(`/characters/${id}/moodboard/order`, 'PUT', { ids: order })
    })
  }

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('image', await fitImage(file, 1200))
        await fetch(`/api/characters/${id}/moodboard`, { method: 'POST', body: form })
      }
      setError(null); await reload()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Something went wrong') }
    finally { setBusy(false) }
  }

  const addPin = (event: FormEvent) => {
    event.preventDefault()
    const url = pinUrl.trim()
    if (!url) return
    setPinUrl('')
    void act(async () => { await api(`/characters/${id}/moodboard/pin`, 'POST', { url }) })
  }

  if (loading) {
    return <section aria-busy="true" className="profile-missing"><p>Loading…</p></section>
  }
  const row = rows.find(character => character.id === id)
  if (!row) {
    return (
      <section aria-labelledby="profile-title" className="profile-missing">
        <h1 id="profile-title">Character not found</h1>
        <a href="#characters">Back to characters</a>
      </section>
    )
  }

  const rpGroups = groups.filter(group => group.characterIds.includes(id))
  const characterBranches = branches.filter(branch => branch.characterId === id)
  const stats: CardStats = { total: characterBranches.length, mine: characterBranches.filter(b => b.status === 'your_turn').length, theirs: characterBranches.filter(b => b.status === 'their_turn').length, rps: rpGroups.map(group => group.name) }
  const profile = card ?? emptyCard()
  const theme = THEMES[profile.theme] ?? THEMES.holo
  const playlist = profile.playlistUrl ? parsePlaylist(profile.playlistUrl) : null
  const boardName = profile.boardUrl ? new URL(profile.boardUrl).pathname.split('/').filter(Boolean).pop() ?? '' : ''

  const portrait = row.iconObjectKey ? `/api/characters/${id}/icon?v=${portraitVersion ?? row.iconObjectKey}` : null

  const uploadIcon = async (file: File) => {
    const form = new FormData()
    form.set('icon', file)
    const response = await fetch(`/api/characters/${id}/icon`, { method: 'POST', body: form })
    if (!response.ok) {
      const problem = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(problem?.error ?? 'Icon upload failed')
    }
    setPortraitVersion(Date.now())
  }

  return (
    <div className="profile-page">
      {/* Same identity name as the card on the Characters page, so the name glides between the two. */}
      <header className="profile-header" style={{ viewTransitionName: `character-${row.id}` }}>
        <h1>{row.name}</h1>
        <p className="profile-sections">
          <strong>RP sections</strong>
          {rpGroups.length ? <span>{rpGroups.map(group => group.name).join(' / ')}</span> : <span>Not sorted yet</span>}
        </p>
        <div className="profile-actions">
          <button type="button" onClick={() => setEditingCard(true)}>Edit card</button>
          <a href="#characters">Back to characters</a>
        </div>
        <p className="profile-stats">{characterBranches.length} thread{characterBranches.length === 1 ? '' : 's'} · your turn on {stats.mine} · their turn on {stats.theirs}</p>
      </header>

      <div className="profile-columns">
        <div className="profile-card-col">
          <TradingCard name={row.name} profile={profile} stats={stats} portrait={portrait} moodboard={moodUrls} />
        </div>

        <div className="profile-side">
          <section className="profile-section" aria-labelledby="moodboard-title">
            <div className="profile-section-head">
              <h2 id="moodboard-title">Moodboard</h2>
              <span>{items.length} of 12</span>
            </div>
            {items.length > 0 ? (
              <ul className="profile-grid" aria-label="Moodboard tiles">
                {items.slice(0, 12).map((item, i) => (
                  <li key={item.id} className="profile-tile">
                    {item.kind === 'pin'
                      ? <iframe src={`https://assets.pinterest.com/ext/embed.html?id=${item.pinId}`} width="100%" height="420" loading="lazy" title="Pinterest pin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
                      : <img src={`/api/characters/${id}/moodboard/${item.id}/image`} loading="lazy" alt="" />}
                    <div className="profile-tile-actions">
                      <button type="button" disabled={i === 0 || busy} onClick={() => move(i, -1)}>Move earlier</button>
                      <button type="button" disabled={i === items.length - 1 || busy} onClick={() => move(i, 1)}>Move later</button>
                      <button type="button" disabled={busy} onClick={() => void act(async () => { await api(`/characters/${id}/moodboard/${item.id}`, 'DELETE') })}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="profile-empty">Upload 8–12 images that feel like this character, or add pins from Pinterest.</p>
            )}
            <div className="profile-controls">
              <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={onFiles} aria-label="Moodboard images" />
              <button type="button" disabled={busy || items.length >= 12} onClick={() => fileRef.current?.click()}>Add images</button>
              <form className="profile-pin-form" onSubmit={addPin}>
                <input type="text" value={pinUrl} onChange={event => setPinUrl(event.target.value)} placeholder="https://pinterest.com/pin/…" aria-label="Pinterest pin link" disabled={busy} />
                <button type="submit" disabled={busy || !pinUrl.trim() || items.length >= 12}>Add a Pinterest pin</button>
              </form>
              <p className="upload-hint">{IMAGE_HINT}</p>
            </div>
          </section>

          {profile.boardUrl && (
            <a className="profile-board" href={profile.boardUrl} target="_blank" rel="noopener noreferrer" style={{ '--board-a': theme.bg[0], '--board-b': theme.bg[1] } as CSSProperties}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v2l-2 9h14l-2-9V7a5 5 0 0 0-5-5Zm0 2.2c1.6 0 2.8 1.2 2.8 2.8v2.2l1.9 7.8H7.3l1.9-7.8V7c0-1.6 1.2-2.8 2.8-2.8Z" />
              </svg>
              <span className="profile-board-text">
                <strong>Full moodboard on Pinterest</strong>
                <small>{boardName.replace(/-/g, ' ')} · by {new URL(profile.boardUrl).hostname}</small>
              </span>
            </a>
          )}

          <section className="profile-section" aria-labelledby="playlist-title">
            <h2 id="playlist-title">Playlist</h2>
            {playlist ? <Playlist player={playlist} tracklist={profile.tracklist} /> : (
              <p className="profile-empty">Paste a Spotify, YouTube, or Apple Music link in Edit card.</p>
            )}
          </section>
        </div>
      </div>

      {error && <p className="profile-error" role="alert">{error}</p>}
      {editingCard && (
        <CardEditor
          row={row}
          stats={stats}
          portrait={portrait}
          upload={file => uploadIcon(file).then(() => reload())}
          close={() => setEditingCard(false)}
          saved={reload}
        />
      )}
    </div>
  )
}

// The click-to-load player. The iframe only exists after the press, so the service's
// trackers never see a visitor who didn't ask for the player.
function Playlist({ player, tracklist }: { player: NonNullable<ReturnType<typeof parsePlaylist>>, tracklist?: string[] }) {
  const [loaded, setLoaded] = useState(false)
  const label = SERVICE_LABEL[player.provider]
  return (
    <div className="profile-playlist">
      {loaded ? (
        player.provider === 'youtube'
          ? <iframe src={player.embedUrl} className="profile-yt" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" referrerPolicy="strict-origin-when-cross-origin" title="YouTube playlist" allowFullScreen />
          : <iframe src={player.embedUrl} height={player.provider === 'spotify' ? 352 : 450} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" referrerPolicy="strict-origin-when-cross-origin" title={`${label} playlist`} />
      ) : (
        <div className="profile-load">
          <button type="button" onClick={() => setLoaded(true)}>Load the {label} player</button>
          <p>Loads {label}’s player, which follows {label}’s privacy policy.</p>
          <a href={player.openUrl} target="_blank" rel="noopener noreferrer">Open in {label}</a>
        </div>
      )}
      {tracklist && tracklist.length > 0 && (
        <ol className="profile-tracklist">{tracklist.map((track, i) => <li key={i}>{track}</li>)}</ol>
      )}
    </div>
  )
}
