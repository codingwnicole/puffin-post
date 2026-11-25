import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import { api, apiUpload, staleGet, type TrackingOptions } from '../lib/api'
import { useNativeDialog } from '../lib/dialog'
import TradingCard, { downloadCard, emptyCard, normalizeCard, THEMES, type CardProfile, type CardStats } from '../components/TradingCard'
import CardEditor from '../components/CardEditor'
import SharePanel from '../components/SharePanel'
import Icon from '../components/Icon'
import { parsePlaylist } from '../../shared/embeds'
import { fitImage, IMAGE_ACCEPT, IMAGE_HINT } from '../lib/uploads'
import type { InboxBranch } from '../../db/repositories/branches'
import BranchRow from '../components/BranchRow'

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null; portraitObjectKey: string | null; card?: CardProfile | null; threadCounts?: { total: number; mine: number; theirs: number } }
type Group = { id: string; name: string; characterIds: string[] }
type MoodboardItem = { id: string; kind: 'image' | 'pin'; pinId: string | null; position: number }

const SERVICE_LABEL = { spotify: 'Spotify', youtube: 'YouTube', apple: 'Apple Music' } as const

export default function CharacterProfilePage({ id }: { id: string }) {
  const [rows, setRows] = useState<Character[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [branches, setBranches] = useState<InboxBranch[]>([])
  const [trackingOptions, setTrackingOptions] = useState<TrackingOptions>({ characters: [], partners: [] })
  const [threadLoadError, setThreadLoadError] = useState('')
  const [items, setItems] = useState<MoodboardItem[]>([])
  const [card, setCard] = useState<CardProfile | null>(null)
  const [moodUrls, setMoodUrls] = useState<string[]>([])
  const [portraitVersion, setPortraitVersion] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingCard, setEditingCard] = useState(false)
  const [showCard, setShowCard] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pinUrl, setPinUrl] = useState('')
  const overlayRef = useRef<HTMLDialogElement>(null)
  const cardAreaRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(true)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useNativeDialog(overlayRef, showCard)
  const closeProfileCard = () => { overlayRef.current?.close(); setShowCard(false) }

  // One reload re-reads everything the page owns: the cast (to find this character), its RP
  // sections and thread counts (on the character), the card, and the moodboard tiles.
  const reload = async (active: () => boolean = () => activeRef.current) => {
    try {
      const [characters, groupRows, board, inbox, options] = await Promise.all([
        staleGet<Character[]>('/characters'),
        staleGet<Group[]>('/rp-groups'),
        api<MoodboardItem[]>(`/characters/${id}/moodboard`).catch(() => [] as MoodboardItem[]),
        api<{branches:InboxBranch[]}>(`/inbox?characterId=${encodeURIComponent(id)}`).then(data => ({ branches: data.branches, loadError: '' }), problem => ({ branches: [] as InboxBranch[], loadError: (problem as Error).message })),
        staleGet<TrackingOptions>('/starters/options').catch(() => ({ characters: [], partners: [] })),
      ])
      if (!active()) return
      setRows(characters); setGroups(groupRows);
      setBranches(inbox.branches); setTrackingOptions(options); setThreadLoadError(inbox.loadError)
      const boardItems = Array.isArray(board) ? board : (board as { items?: MoodboardItem[] }).items ?? []
      setItems(boardItems)
      setMoodUrls(boardItems.filter(item => item.kind === 'image').map(item => `/api/characters/${id}/moodboard/${item.id}/image`))
      const match = characters.find(c => c.id === id)
      setCard(normalizeCard(match?.card))
    } catch (problem) { if (active()) setError(problem instanceof Error ? problem.message : 'Something went wrong') }
    finally { if (active()) setLoading(false) }
  }

  useEffect(() => { let active = true; activeRef.current = true; void reload(() => active); return () => { active = false; activeRef.current = false } }, [id])

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
        await apiUpload(`/characters/${id}/moodboard`, form)
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
    return <section aria-busy="true" className="profile-missing rd-profile-missing"><p>Loading…</p></section>
  }
  const row = rows.find(character => character.id === id)
  if (!row) {
    return (
        <section aria-labelledby="profile-title" className="profile-missing rd-profile-missing">
        <h1 id="profile-title">Character not found</h1>
        <a href="#characters">Back to characters</a>
      </section>
    )
  }

  const rpGroups = groups.filter(group => group.characterIds.includes(id))
  const stats: CardStats = { ...(rows.find(row => row.id === id)?.threadCounts ?? { total: 0, mine: 0, theirs: 0 }), rps: rpGroups.map(group => group.name) }
  const profile = card ?? emptyCard()
  const theme = THEMES[profile.theme] ?? THEMES.holo
  const playlist = profile.playlistUrl ? parsePlaylist(profile.playlistUrl) : null
  const boardName = profile.boardUrl ? new URL(profile.boardUrl).pathname.split('/').filter(Boolean).pop() ?? '' : ''

  // /portrait already falls back to the legacy icon, so older cards retain their original art.
  const portraitKey = row.portraitObjectKey ?? row.iconObjectKey
  const portrait = portraitKey ? `/api/characters/${id}/portrait?v=${portraitVersion ?? portraitKey}` : null

  // CardEditor's "Upload portrait": the card art, separate from the character's icon.
  const uploadPortrait = async (file: File) => {
    const form = new FormData()
    form.set('image', file)
    await apiUpload(`/characters/${id}/portrait`, form)
    setPortraitVersion(Date.now())
  }

  return (
    <div className="profile-page rd-profile-page">
      {/* Same identity name as the card on the Characters page, so the name glides between the two. */}
      <header className="profile-header rd-profile-hero" style={{ viewTransitionName: `character-${row.id}` }}>
        <div className="profile-preview rd-profile-preview" ref={cardAreaRef}>
          <TradingCard name={row.name} profile={profile} stats={stats} portrait={portrait} moodboard={moodUrls} />
        </div>
        <div className="profile-header-text">
          <h1>{row.name}</h1>
          <p className="profile-sections">
            <strong>RP sections</strong>
            {rpGroups.length ? <span>{rpGroups.map(group => group.name).join(' / ')}</span> : <span>Not sorted yet</span>}
          </p>
          <p className="profile-stats">{stats.total} thread{stats.total === 1 ? '' : 's'} · your turn on {stats.mine} · their turn on {stats.theirs}</p>
          <div className="profile-actions">
            <button type="button" className="secondary-button" onClick={() => setShowCard(true)}>View card</button>
            <button type="button" onClick={() => setEditingCard(true)}>Edit card</button>
            <button type="button" className="secondary-button" onClick={() => setSharing(true)}>Share</button>
            <a className="button secondary-button" href={'#dashboard?characterId=' + encodeURIComponent(row.id)}>View threads</a>
            <a href="#characters">Back to characters</a>
          </div>
        </div>
      </header>

      {showCard && <dialog className="profile-overlay rd-dialog rd-profile-card-dialog" aria-label={`${row.name}'s card`} ref={overlayRef} onCancel={event => { event.preventDefault(); closeProfileCard() }} onClick={event => { if (event.target === event.currentTarget) closeProfileCard() }}>
        <div className="profile-overlay-card rd-dialog-card">
          <TradingCard name={row.name} profile={profile} stats={stats} portrait={portrait} moodboard={moodUrls} />
          <div className="profile-overlay-actions">
            <button type="button" disabled={downloading} onClick={async () => { try { setDownloading(true); await downloadCard(overlayRef.current!, row.name) } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not download the card') } finally { setDownloading(false) } }}>{downloading ? 'Preparing…' : 'Download'}</button>
            <button type="button" onClick={closeProfileCard}>Close</button>
          </div>
        </div>
      </dialog>}

      <div className="profile-content rd-profile-content">
        <section className="profile-section rd-profile-moodboard" aria-labelledby="moodboard-title">
          <div className="profile-section-head"><div><h2 id="moodboard-title">Moodboard</h2></div><span>{items.length} of 12</span></div>
          <ul className="profile-grid" aria-label="Moodboard tiles">
            {Array.from({ length: 12 }, (_, i) => {
              const item = items[i]
              return item ? (
                <li key={item.id} className="profile-tile">
                  {item.kind === 'pin'
                    ? <iframe src={`https://assets.pinterest.com/ext/embed.html?id=${item.pinId}`} width="100%" height="320" loading="lazy" title={`Pinterest pin ${i + 1}`} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
                    : <img src={`/api/characters/${id}/moodboard/${item.id}/image`} loading="lazy" alt="" />}
                  <div className="profile-tile-actions">
                    <button type="button" disabled={i === 0 || busy} onClick={() => move(i, -1)}>Move earlier</button>
                    <button type="button" disabled={i === items.length - 1 || busy} onClick={() => move(i, 1)}>Move later</button>
                    <button type="button" disabled={busy} onClick={() => void act(async () => { await api(`/characters/${id}/moodboard/${item.id}`, 'DELETE') })}>Remove</button>
                  </div>
                </li>
              ) : <li key={`empty-${i}`} className="profile-empty-tile" aria-label={`Empty moodboard slot ${i + 1}`}><span>{String(i + 1).padStart(2, '0')}</span></li>
            })}
          </ul>
          {items.length === 0 && <p className="profile-empty">Upload 8–12 images that feel like this character, or add pins from Pinterest.</p>}
          <div className="profile-controls">
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={onFiles} aria-label="Moodboard images" />
            <button type="button" disabled={busy || items.length >= 12} onClick={() => fileRef.current?.click()}>Add images</button>
            <form className="profile-pin-form" onSubmit={addPin}>
              <label htmlFor="profile-pin-url">Pinterest pin link</label>
              <input id="profile-pin-url" type="url" value={pinUrl} onChange={event => setPinUrl(event.target.value)} placeholder="https://pinterest.com/pin/." disabled={busy || items.length >= 12} />
              <button type="submit" disabled={busy || !pinUrl.trim() || items.length >= 12}>Add a Pinterest pin</button>
            </form>
            <p className="upload-hint">{IMAGE_HINT}</p>
          </div>
        </section>

        <aside className="rd-profile-sidebar">
          <section className="profile-section rd-profile-stats" aria-labelledby="profile-stats-title">
            <div className="profile-section-head"><div><h2 id="profile-stats-title">Thread stats</h2></div></div>
            <div className="rd-profile-counts"><div><strong>{stats.total}</strong><span>threads</span></div><div><strong>{stats.mine}</strong><span>your turn</span></div><div><strong>{stats.theirs}</strong><span>their turn</span></div></div>
            <p className="rd-profile-rps">Writes in {rpGroups.length ? rpGroups.map(group => group.name).join(' · ') : 'no RP section yet'}</p>
          </section>

          <section className="profile-section rd-profile-about" aria-labelledby="profile-about-title">
            <div className="profile-section-head"><div><h2 id="profile-about-title">About</h2></div></div>
            {profile.quote && <blockquote>{profile.quote}</blockquote>}
            <dl className="rd-profile-details">
              {profile.age && <div><dt>Age</dt><dd>{profile.age}</dd></div>}
              {profile.birthdate && <div><dt>Birthdate</dt><dd>{profile.birthdate}</dd></div>}
              {profile.likes && <div><dt>Likes</dt><dd>{profile.likes}</dd></div>}
              {profile.dislikes && <div><dt>Dislikes</dt><dd>{profile.dislikes}</dd></div>}
              {profile.notes && <div className="rd-profile-detail-wide"><dt>Notes</dt><dd>{profile.notes}</dd></div>}
            </dl>
            {!profile.quote && !profile.age && !profile.birthdate && !profile.likes && !profile.dislikes && !profile.notes && <p className="profile-empty">Add a quote and character notes from Edit card.</p>}
          </section>

          <section className="profile-section rd-profile-facts" aria-labelledby="profile-facts-title">
            <div className="profile-section-head"><div><h2 id="profile-facts-title">Fun facts</h2></div></div>
            {profile.facts.some(fact => fact.trim()) ? <ul>{profile.facts.filter(fact => fact.trim()).map((fact, i) => <li key={i}>{fact}</li>)}</ul> : <p className="profile-empty">Add fun facts from Edit card.</p>}
          </section>

          <section className="profile-section rd-profile-playlist" aria-labelledby="playlist-title">
            <div className="profile-section-head"><div><h2 id="playlist-title">Playlist</h2></div></div>
            {playlist ? <Playlist player={playlist} /> : <p className="profile-empty">Paste a Spotify, YouTube, or Apple Music link in Edit card.</p>}
          </section>

          {profile.tracklist.some(track => track.trim()) && <section className="profile-section rd-profile-tracklist" aria-labelledby="tracklist-title"><div className="profile-section-head"><div><h2 id="tracklist-title">Tracklist</h2></div></div><ol className="profile-tracklist">{profile.tracklist.filter(track => track.trim()).slice(0, 10).map((track, i) => <li key={i}>{track}</li>)}</ol></section>}
        </aside>

        <section className="profile-section rd-profile-threads" aria-labelledby="profile-threads-title">
          <div className="profile-section-head rd-profile-threads-head">
            <div><h2 id="profile-threads-title">Tracked threads</h2></div>
            <a className="text-button" href={'#dashboard?characterId=' + encodeURIComponent(row.id)}>Open in dashboard</a>
          </div>
          {threadLoadError
            ? <p role="alert" className="profile-empty">Could not load this character's threads. <a href={'#dashboard?characterId=' + encodeURIComponent(row.id)}>Open the filtered dashboard.</a></p>
            : branches.length
            ? <div className="rd-profile-thread-list">{branches.map(branch => <BranchRow key={branch.id} branch={branch} options={trackingOptions} onChange={reload} />)}</div>
            : <p className="profile-empty">No active threads for {row.name} yet. <a href={'#dashboard?characterId=' + encodeURIComponent(row.id)}>Add one from the dashboard.</a></p>}
        </section>

        {profile.boardUrl && <a className="profile-board rd-profile-board" href={profile.boardUrl} target="_blank" rel="noopener noreferrer" style={{ '--board-a': theme.bg[0], '--board-b': theme.bg[1] } as CSSProperties}><Icon name="pin" /><span className="profile-board-text"><strong>Full moodboard on Pinterest</strong><small>{boardName.replace(/-/g, ' ')} · by {new URL(profile.boardUrl).hostname}</small></span></a>}
      </div>

      {error && <p className="profile-error rd-profile-error" role="alert">{error}</p>}
      {editingCard && (
        <CardEditor
          row={row}
          stats={stats}
          portrait={portrait}
          upload={file => uploadPortrait(file).then(() => reload())}
          close={() => setEditingCard(false)}
          saved={reload}
        />
      )}
      {sharing && (
        <SharePanel
          character={row}
          counts={{ total: stats.total, mine: stats.mine, theirs: stats.theirs }}
          stats={stats}
          cardRef={cardAreaRef}
          close={() => setSharing(false)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

// The click-to-load player. The iframe only exists after the press, so the service's
// trackers never see a visitor who didn't ask for the player.
function Playlist({ player }: { player: NonNullable<ReturnType<typeof parsePlaylist>> }) {
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
    </div>
  )
}
