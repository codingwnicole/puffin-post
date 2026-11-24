import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, apiUpload, peekCache, staleGet } from '../lib/api'
import { useNativeDialog } from '../lib/dialog'
import { useEntered } from '../lib/motion'
import { downloadBlob, fileSlug, statsCardBlob, type Counts } from '../lib/stats-card'
import { IMAGE_ACCEPT, IMAGE_HINT, PORTRAIT_HINT, squareIcon } from '../lib/uploads'
import { toast, undoCharacterArchive, undoReturnToPlanner } from '../lib/toast'
import { initialsFor } from '../components/InitialsAvatar'
import TradingCard, { THEMES, downloadCard, normalizeCard, type CardProfile, type CardStats, type ThemeId } from '../components/TradingCard'
import CardEditor from '../components/CardEditor'
import SharePanel from '../components/SharePanel'

// A single moodboard entry as GET /characters/:id/moodboard returns it (kind, not the stored file).
type MoodboardItem = { id: string; kind: 'image' | 'pin' }

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null; portraitObjectKey: string | null; card?: CardProfile | null; threadCounts?: Counts }
type ArchivedCharacter = { id: string; name: string; color: string | null; notes: string | null; iconObjectKey: string | null; createdAt: string; rpGroupNames: string[]; threadCount: number }
type Connection = { assignments: { characterId: string; blogIdentifier: string; characterTag: string | null }[] }
type Group = { id: string; name: string; characterIds: string[] }
const blogLabel = (value: string) => value.replace(/\.tumblr\.com$/i, '')

async function exportCharacterCard(character: Character, counts: Counts) {
  downloadBlob(await statsCardBlob(character, counts), fileSlug(character.name, 'character') + '-rp-thread-buddy-stats.png')
}

async function exportRpStats(group: Group, characters: Character[], counts: Record<string, Counts>) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not make an RP stats card')
  canvas.width = 1200; canvas.height = Math.max(460, 220 + characters.length * 132)
  // Writer's Desk paper palette (canvas export: colours are data here, not CSS tokens)
  context.fillStyle = '#FBF8F2'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#56715B'; context.fillRect(0, 0, canvas.width, 160)
  context.fillStyle = '#f8f3e9'; context.font = '700 28px system-ui'; context.fillText('RP THREAD BUDDY  /  RP STATS', 70, 76)
  context.font = '600 66px Georgia'; context.fillText(group.name.slice(0, 30), 70, 135)
  context.font = '700 18px system-ui'; context.fillStyle = '#DDE6D8'; context.fillText(`${characters.length} CHARACTER${characters.length === 1 ? '' : 'S'}`, 920, 76)
  ;[['CHARACTER', 70], ['THREADS', 680], ['YOUR TURN', 840], ['THEIR TURN', 1010]].forEach(([label, x]) => { context.fillStyle = '#5C544B'; context.font = '700 18px system-ui'; context.fillText(String(label), Number(x), 205) })
  for (const [index, character] of characters.entries()) {
    const current = counts[character.id] ?? { total: 0, mine: 0, theirs: 0 }, y = 230 + index * 132
    context.fillStyle = index % 2 ? '#F5EFE6' : '#EDE5D9'; context.fillRect(55, y, 1090, 102)
    context.save(); context.beginPath(); context.arc(106, y + 51, 28, 0, Math.PI * 2); context.clip()
    if (character.iconObjectKey) {
      const icon = await fetch('/api/characters/' + character.id + '/icon').then(response => response.ok ? response.blob() : null)
      if (icon) { const url = URL.createObjectURL(icon), image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load character icon')); image.src = url }); context.drawImage(image, 78, y + 23, 56, 56); URL.revokeObjectURL(url) }
    } else { context.fillStyle = '#DDE6D8'; context.fillRect(78, y + 23, 56, 56); context.fillStyle = '#2D2925'; context.font = '600 30px Georgia'; context.fillText(character.name.slice(0, 1).toUpperCase(), 96, y + 62) }
    context.restore(); context.strokeStyle = '#56715B'; context.lineWidth = 2; context.beginPath(); context.arc(106, y + 51, 28, 0, Math.PI * 2); context.stroke()
    context.fillStyle = '#2D2925'; context.font = '600 34px Georgia'; context.fillText(character.name.slice(0, 27), 155, y + 61)
    ;[[current.total, 720], [current.mine, 885], [current.theirs, 1060]].forEach(([value, x]) => { context.font = '600 42px Georgia'; context.fillText(String(value), x, y + 65) })
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export RP stats')
  downloadBlob(blob, fileSlug(group.name, 'rp') + '-rp-thread-buddy-stats.png')
}

function Quicklinks({ characterId }: { characterId: string }) {
  const [links, setLinks] = useState<{ id: string; label: string; url: string }[]>([])
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const activeRef = useRef(true)
  const load = () => api<{ id: string; label: string; url: string }[]>('/characters/' + characterId + '/quicklinks').then(rows => { if (activeRef.current) setLinks(rows) }).catch(problem => { if (activeRef.current) setError(problem.message) })
  useEffect(() => { activeRef.current = true; void load(); return () => { activeRef.current = false } }, [characterId])
  const remove = async (linkId: string) => { setBusy(true); setError(''); try { await api('/characters/' + characterId + '/quicklinks/' + linkId, 'DELETE'); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }
  return <section className="character-quicklinks"><div><strong>Quicklinks</strong><button type="button" className="text-button" disabled={busy} onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add link'}</button></div>{links.length > 0 ? <ul>{links.map(link => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a><button type="button" className="text-button" disabled={busy} onClick={() => void remove(link.id)}>Remove</button></li>)}</ul> : <p>Keep gif packs, icon pages, playlists, or reference links here.</p>}{adding && <form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); setError(''); try { await api('/characters/' + characterId + '/quicklinks', 'POST', { label: data.get('label'), url: data.get('url') }); form.reset(); setAdding(false); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}><label>Label<input name="label" maxLength={120} required placeholder="gif pack" /></label><label>Link<input name="url" type="url" required placeholder="https://" /></label><button disabled={busy}>{busy ? 'Saving.' : 'Add quicklink'}</button></form>}{error && <p role="alert">{error}</p>}</section>
}

function CharacterCard({ row, index, assignments, groups, stat, iconVersion, busy, addToGroup, upload, remove, returnToPlanner, showCreateGroup, reportError, editCard }: { row: Character; index?: number; assignments: Connection['assignments']; groups: Group[]; stat: Counts; iconVersion?: number; busy: boolean; addToGroup: (groupId: string, characterId: string) => Promise<void>; upload: (id: string, file: File) => Promise<void>; remove: (id: string) => Promise<void>; returnToPlanner:(id:string)=>Promise<void>; showCreateGroup: () => void; reportError: (error: string) => void; editCard: () => void }) {
  const characterAssignments = assignments.filter(assignment => assignment.characterId === row.id)
  const characterGroups = groups.filter(group => group.characterIds.includes(row.id))
  const availableGroups = groups.filter(group => !group.characterIds.includes(row.id))
  return <article className="character-card tracking-card" style={{'--i':index ?? 0} as CSSProperties}>
    <div className="character-card-top">{row.iconObjectKey ? <img className="character-avatar" loading="lazy" alt="" width={44} height={44} src={'/api/characters/' + row.id + '/icon?v=' + (iconVersion ?? row.iconObjectKey)} onError={event => event.currentTarget.classList.add('avatar-fallback')} data-initials={initialsFor(row.name)} /> : <span className="character-avatar character-initials" aria-hidden="true">{initialsFor(row.name)}</span>}<div><p className="eyebrow">{row.state}</p><h3><a className="character-card-top-link" href={'#character/' + row.id} style={{ viewTransitionName: `character-${row.id}` }}>{row.name}</a></h3>{characterAssignments.length ? <p className="field-help"><strong>Tumblr assigned:</strong> {characterAssignments.map(assignment => blogLabel(assignment.blogIdentifier)).join(', ')}</p> : <p className="field-help">Next: <a href="#connections">assign Tumblr</a></p>}</div></div>
    <div className="character-rps"><strong>RP sections</strong>{characterGroups.length ? <span>{characterGroups.map(group => group.name).join(' / ')}</span> : <span>Not sorted yet</span>}{!characterGroups.length && availableGroups.length > 0 ? <label>Add {row.name} to an RP section<select className="character-rp-picker" value="" disabled={busy} onChange={event => { if (event.target.value) void addToGroup(event.target.value, row.id) }}><option value="">Add to RP.</option>{availableGroups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label> : !characterGroups.length ? <button type="button" className="text-button" onClick={showCreateGroup}>Create an RP</button> : null}</div>
    <div className="character-stats"><a href={'#dashboard?characterId=' + row.id}><strong>{stat.total}</strong> thread{stat.total === 1 ? '' : 's'}</a><span><strong>{stat.mine}</strong> your turn</span><span><strong>{stat.theirs}</strong> their turn</span></div>
    <Quicklinks characterId={row.id} />
    <div className="character-actions"><button type="button" className="secondary-button character-card-action" onClick={editCard}>{row.card ? 'Edit trading card' : 'Make trading card'}</button><label className="icon-picker" title={IMAGE_HINT}>{row.iconObjectKey ? 'Replace icon' : 'Upload icon'}<input type="file" accept={IMAGE_ACCEPT} disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(row.id, file) }} /></label><details className="character-more"><summary>More</summary><div className="character-more-menu"><button type="button" className="secondary-button" onClick={editCard}>{row.card ? 'Edit trading card' : 'Make a trading card'}</button><button type="button" className="secondary-button" onClick={() => void exportCharacterCard(row, stat).catch(problem => reportError(problem.message))}>Export stats card</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void returnToPlanner(row.id)}>Return to planner</button><button className="danger-button" type="button" disabled={busy} onClick={() => void remove(row.id)}>Remove character</button></div></details></div>
  </article>
}

// Cards created before portraits were split from character icons still keep their art in iconObjectKey.
const portraitFor = (row: Character, version?: number) => {
  const key = row.portraitObjectKey ?? row.iconObjectKey
  return key ? '/api/characters/' + row.id + '/portrait?v=' + (version ?? key) : null
}
const VIEW_KEY = 'puffin.characters.view'

function CardTile({ row, index, stats, portrait, moodUrls, edit, reportError }: { row: Character; index?: number; stats: CardStats; portrait: string | null; moodUrls?: string[]; edit: () => void; reportError: (error: string) => void }) {
  const tile = useRef<HTMLElement>(null), [saving, setSaving] = useState(false), [note, setNote] = useState(''), [sharing, setSharing] = useState(false)
  const counts = { total: stats.total, mine: stats.mine, theirs: stats.theirs }
  const download = async () => { try { setSaving(true); setNote(''); const kind = await downloadCard(tile.current!, row.name); setNote(kind === 'gif' ? 'Saved as an animated GIF.' : kind === 'png-no-gif-support' ? 'This browser can’t make animated GIFs, so the card was saved as a PNG.' : 'Saved as a PNG.') } catch (problem) { reportError((problem as Error).message) } finally { setSaving(false) } }
  return <article className="tcard-tile" ref={tile} aria-label={row.name} style={{ '--i': index ?? 0 } as CSSProperties}>
    <TradingCard name={row.name} profile={normalizeCard(row.card)} stats={stats} portrait={portrait} moodboard={moodUrls} />
    <div className="tcard-actions"><button type="button" className="secondary-button" onClick={edit}>{row.card ? 'Edit card' : 'Make a card'}</button><button type="button" className="secondary-button" disabled={saving} title="Animated GIF when the portrait is a GIF, otherwise PNG" onClick={() => void download()}>{saving ? 'Preparing…' : 'Download'}</button><button type="button" className="secondary-button" onClick={() => setSharing(true)}>Share</button></div><p className="field-help tcard-note" role="status">{note}</p>
    {sharing && <SharePanel character={row} counts={counts} stats={stats} cardRef={tile} close={() => setSharing(false)} />}
  </article>
}

export default function CharactersPage() {
  const [rows, setRows] = useState<Character[]>(() => peekCache<Character[]>('/characters') ?? []), [assignments, setAssignments] = useState<Connection['assignments']>(() => (peekCache<Connection[]>('/connections') ?? []).flatMap(connection => connection.assignments)), [groups, setGroups] = useState<Group[]>(() => peekCache<Group[]>('/rp-groups') ?? [])
  const [moodboards, setMoodboards] = useState<Record<string, string[]>>({})
  const [error, setError] = useState(''), [adding, setAdding] = useState(false), [addingGroup, setAddingGroup] = useState(false), [busy, setBusy] = useState(false), [iconVersions, setIconVersions] = useState<Record<string, number>>({})
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; threads: number } | null>(null)
  const [deleteStep, setDeleteStep] = useState<'choose' | 'confirm'>('choose')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  useNativeDialog(deleteDialogRef, Boolean(deleteTarget))
  const [pickerOpen, setPickerOpen] = useState(false), [pickerId, setPickerId] = useState('')
  const pickerRef = useRef<HTMLDialogElement>(null)
  useNativeDialog(pickerRef, pickerOpen)
  const activeRef = useRef(true)
  const closeDeleteDialog = () => { deleteDialogRef.current?.close(); setDeleteTarget(null); setDeleteStep('choose') }
  const [view, setViewState] = useState<'details' | 'cards'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'details' } catch { return 'details' } })
  const setView = (next: 'details' | 'cards') => { setViewState(next); try { localStorage.setItem(VIEW_KEY, next) } catch { /* per-viewer convenience only */ } }
  // Moodboard image URLs per character — fetched only in the Cards view (the card's mood side
  // needs them) so the Details view never pays for boards it will not draw.
  useEffect(() => { if (view !== 'cards') return; let cancelled = false; void Promise.all(rows.map(async character => { try { const board = await api<MoodboardItem[] | { items: MoodboardItem[] }>('/characters/' + character.id + '/moodboard'); const items = Array.isArray(board) ? board : board.items ?? []; return [character.id, items.filter(item => item.kind === 'image').map(item => '/api/characters/' + character.id + '/moodboard/' + item.id + '/image')] as const } catch { return [character.id, [] as string[]] as const } })).then(entries => { if (!cancelled) setMoodboards(Object.fromEntries(entries)) }); return () => { cancelled = true } }, [view, rows])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(() => ['/characters', '/connections', '/rp-groups'].every(path => peekCache(path) !== undefined))
  const entered = useEntered(loaded && rows.length > 0)
  const load = () => Promise.all([staleGet<Character[]>('/characters'), staleGet<Connection[]>('/connections'), staleGet<Group[]>('/rp-groups')]).then(([characters, connections, nextGroups]) => { if (!activeRef.current) return; setRows(characters); setAssignments(connections.flatMap(connection => connection.assignments)); setGroups(nextGroups); setLoaded(true) }).catch(problem => { if (!activeRef.current) return; setError(problem.message); setLoaded(true) })
  useEffect(() => { activeRef.current = true; void load(); return () => { activeRef.current = false } }, [])
  const counts = useMemo(() => Object.fromEntries(rows.map(character => [character.id, character.threadCounts ?? { total: 0, mine: 0, theirs: 0 }])), [rows]) as Record<string, Counts>
  const groupedCharacters = useMemo(() => groups.map(group => ({ group, characters: rows.filter(row => group.characterIds.includes(row.id)) })).filter(section => section.characters.length > 0), [groups, rows])
  const unassignedCharacters = useMemo(() => rows.filter(row => !groups.some(group => group.characterIds.includes(row.id))), [groups, rows])
  async function upload(id: string, file: File) { try { setBusy(true); setError(''); const form = new FormData(); form.set('icon', await squareIcon(file)); await apiUpload('/characters/' + id + '/icon', form); setIconVersions(current => ({ ...current, [id]: Date.now() })); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }
  async function addToGroup(groupId: string, characterId: string) { try { setBusy(true); setError(''); await api('/rp-groups/' + groupId + '/characters', 'POST', { characterId }); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }
  async function remove(id: string) { const row = rows.find(r => r.id === id); if (!row) return; setDeleteTarget({ id, name: row.name, threads: counts[id]?.total ?? 0 }); setDeleteStep('choose') }
  async function archiveCharacter(id: string) { const row = rows.find(r => r.id === id); if (!row) return; try { setError(''); setDeleteBusy(true); await api('/characters/' + id + '/archive', 'POST'); closeDeleteDialog(); await load(); toast(`Archived ${row.name}.`, undoCharacterArchive(id)) } catch (problem) { setError((problem as Error).message) } finally { setDeleteBusy(false) } }
  async function confirmDelete() { if (!deleteTarget) return; try { setError(''); setDeleteBusy(true); await api('/characters/' + deleteTarget.id, 'DELETE'); closeDeleteDialog(); await load() } catch (problem) { setError((problem as Error).message) } finally { setDeleteBusy(false) } }
  async function returnToPlanner(id:string){const row=rows.find(r=>r.id===id);if(!row)return;try{setBusy(true);setError('');const moved=await api<{created?:boolean}>('/characters/'+id+'/return-to-planner','POST');toast('Moved '+row.name+' to the planner.',undoReturnToPlanner(id,row.state,moved.created!==false));await load();window.location.hash='planner'}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
  const cardStats = (row: Character): CardStats => ({ ...(counts[row.id] ?? { total: 0, mine: 0, theirs: 0 }), rps: groups.filter(group => group.characterIds.includes(row.id)).map(group => group.name) })
  const editing = rows.find(row => row.id === editingId)
  const beginCardPicker = () => { setPickerId(rows[0]?.id ?? ''); setPickerOpen(true) }
  const editPickedCard = () => { if (!pickerId) return; pickerRef.current?.close(); setPickerOpen(false); setEditingId(pickerId) }
  const card = (row: Character, index?: number) => view === 'cards' ? <CardTile key={row.id} index={index} row={row} stats={cardStats(row)} portrait={row.card ? portraitFor(row, iconVersions[row.id]) : null} moodUrls={row.card ? moodboards[row.id] : undefined} edit={() => setEditingId(row.id)} reportError={setError} /> : <CharacterCard editCard={() => setEditingId(row.id)} key={row.id} index={index} row={row} assignments={assignments} groups={groups} stat={counts[row.id] ?? { total: 0, mine: 0, theirs: 0 }} iconVersion={iconVersions[row.id]} busy={busy} addToGroup={addToGroup} upload={upload} remove={remove} returnToPlanner={returnToPlanner} showCreateGroup={() => setAddingGroup(true)} reportError={setError} />
  return <section className="rd-characters" aria-labelledby="page-title"><div className="character-page-heading"><div><h1 id="page-title" className="page-heading">Characters</h1><p className="page-description">Build your cast, connect their Tumblr, and place them in the RP spaces where they write.</p><p className="field-help upload-hint"><strong>Images:</strong> {IMAGE_HINT}</p></div><div className="actions"><div className="view-switch" role="group" aria-label="Show characters as"><button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>Details</button><button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</button></div><button type="button" className="secondary-button" disabled={!rows.length} onClick={beginCardPicker}>Make or edit a card</button><button className="secondary-button" onClick={() => setAddingGroup(!addingGroup)}>{addingGroup ? 'Close' : 'Add an RP'}</button><button onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add character'}</button></div></div>
    {error && <p role="alert">{error}</p>}
    {addingGroup && <form className="character-create tracking-card" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, name = new FormData(form).get('name'); setBusy(true); setError(''); try { await api('/rp-groups', 'POST', { name }); form.reset(); setAddingGroup(false); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}><label>RP name<input name="name" required maxLength={120} autoFocus placeholder="e.g. your group RP or verse name" /></label><button disabled={busy}>{busy ? 'Saving.' : 'Add RP'}</button></form>}
    {adding && <form className="character-create tracking-card" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, name = new FormData(form).get('name'); setBusy(true); setError(''); try { await api('/characters', 'POST', { name, state: 'active' }); form.reset(); setAdding(false); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}><label>Name<input name="name" required maxLength={200} autoFocus placeholder="Character name" /></label><button disabled={busy}>{busy ? 'Saving.' : 'Add to cast'}</button></form>}
    {!loaded ? (
      <div className="skeletons character-skeletons" aria-hidden="true">
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
      </div>
    ) : (
    <>
    {groupedCharacters.map(({ group, characters }) => <section className="character-rp-section" key={group.id} aria-labelledby={'rp-' + group.id}><div className="character-rp-heading"><div><h2 id={'rp-' + group.id}>{group.name}</h2></div><div className="character-rp-actions"><span>{characters.length} {characters.length === 1 ? 'character' : 'characters'}</span>{characters.length > 1 && <button type="button" className="secondary-button" onClick={() => void exportRpStats(group, characters, counts).catch(problem => setError(problem.message))}>Export RP stats</button>}</div></div><div className="character-grid" data-entered={entered ? '' : undefined}>{characters.map((row, index) => card(row, index))}</div></section>)}
    {unassignedCharacters.length > 0 && <section className="character-rp-section character-unsorted"><div className="character-rp-heading"><div><h2>Characters without an RP section</h2></div><span>{unassignedCharacters.length} {unassignedCharacters.length === 1 ? 'character' : 'characters'}</span></div><div className="character-grid" data-entered={entered ? '' : undefined}>{unassignedCharacters.map((row, index) => card(row, index))}</div></section>}
    {!rows.length && <p>No characters yet. Add your first one above.</p>}
    </>
    )}
    {pickerOpen && <dialog ref={pickerRef} className="rd-dialog rd-card-picker" aria-labelledby="card-picker-title" onCancel={event => { event.preventDefault(); pickerRef.current?.close(); setPickerOpen(false) }} onClick={event => { if (event.target === event.currentTarget) { pickerRef.current?.close(); setPickerOpen(false) } }}><div className="rd-dialog-card"><div className="rd-dialog-heading"><div><p className="eyebrow">Trading cards</p><h2 id="card-picker-title">Choose a character</h2><p>Pick who you want to make or edit a card for.</p></div><button type="button" className="secondary-button" aria-label="Close character picker" onClick={() => { pickerRef.current?.close(); setPickerOpen(false) }}>Close</button></div><label className="rd-field">Character<select value={pickerId} onChange={event => setPickerId(event.target.value)}>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="rd-dialog-actions"><button type="button" className="rd-button-primary" disabled={!pickerId} onClick={editPickedCard}>Continue</button><button type="button" className="secondary-button" onClick={() => { pickerRef.current?.close(); setPickerOpen(false) }}>Cancel</button></div></div></dialog>}
    {editing && <CardEditor row={editing} stats={cardStats(editing)} portrait={portraitFor(editing, iconVersions[editing.id])} upload={async file => { const form = new FormData(); form.set('image', file); await apiUpload('/characters/' + editing.id + '/portrait', form); setIconVersions(v => ({ ...v, [editing.id]: Date.now() })); await load() }} close={() => setEditingId(null)} saved={load} />}
    {deleteTarget && (
      <dialog ref={deleteDialogRef} className="modal-overlay rd-dialog rd-character-delete-dialog" aria-labelledby="delete-dialog-title" onCancel={event => { event.preventDefault(); if (!deleteBusy) closeDeleteDialog() }}>
        <div className="modal-card rd-dialog-card">
          {deleteStep === 'choose' ? (
            <>
              <h3 id="delete-dialog-title">What would you like to do with {deleteTarget.name}?</h3>
              <p className="page-description">Archiving keeps all threads, quicklinks, and RP memberships. Deleting removes everything permanently.</p>
              <div className="modal-actions">
                <button className="secondary-button" disabled={deleteBusy} onClick={() => void archiveCharacter(deleteTarget.id)}>{deleteBusy ? 'Working…' : 'Archive'}</button>
                <button className="danger-button" disabled={deleteBusy} onClick={() => setDeleteStep('confirm')}>Delete</button>
                <button className="text-button" onClick={closeDeleteDialog}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <h3 id="delete-dialog-title">Permanently delete {deleteTarget.name}?</h3>
              <p className="page-description">This cannot be undone. {deleteTarget.threads} thread{deleteTarget.threads === 1 ? '' : 's'} will be removed along with all quicklinks, RP memberships, and blog links.</p>
              <p className="page-description">If you might want this character back later, archiving is safer.</p>
              <div className="modal-actions">
                <button className="secondary-button" disabled={deleteBusy} onClick={() => void archiveCharacter(deleteTarget.id)}>{deleteBusy ? 'Working…' : 'Archive instead'}</button>
                <button className="danger-button" disabled={deleteBusy} onClick={() => void confirmDelete()}>{deleteBusy ? 'Deleting…' : 'Delete permanently'}</button>
                <button className="text-button" disabled={deleteBusy} onClick={closeDeleteDialog}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </dialog>
    )}
  </section>
}
