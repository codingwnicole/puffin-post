import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { api, peekCache, staleGet } from '../lib/api'
import { toast, undoCharacterArchive, undoReturnToPlanner } from '../lib/toast'
import { initialsFor } from '../components/InitialsAvatar'

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null }
type ArchivedCharacter = { id: string; name: string; color: string | null; notes: string | null; iconObjectKey: string | null; createdAt: string; rpGroupNames: string[]; threadCount: number }
type Connection = { assignments: { characterId: string; blogIdentifier: string; characterTag: string | null }[] }
type Group = { id: string; name: string; characterIds: string[] }
type InboxBranch = { characterId: string; status: string }
type Counts = { total: number; mine: number; theirs: number }
const blogLabel = (value: string) => value.replace(/\.tumblr\.com$/i, '')

async function squareIcon(file: File) {
  const image = await createImageBitmap(file)
  const size = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  canvas.width = 300; canvas.height = 300
  if (!context) throw new Error('Could not prepare image')
  context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 300, 300)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .9))
  if (!blob) throw new Error('Could not prepare image')
  return new File([blob], 'character-icon.webp', { type: 'image/webp' })
}

async function exportCharacterCard(character: Character, counts: Counts) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not make a stats card')
  canvas.width = 1200; canvas.height = 630
  context.fillStyle = '#182126'; context.fillRect(0, 0, 1200, 630); context.fillStyle = '#234e61'; context.fillRect(0, 0, 1200, 170)
  context.fillStyle = '#f8f3e9'; context.font = '700 34px system-ui'; context.fillText('PUFFIN POST  /  WRITING STATS', 70, 93)
  context.font = '600 74px Georgia'; context.fillText(character.name.slice(0, 24), 330, 270)
  context.fillStyle = '#a9d4dc'; context.font = '700 24px system-ui'; context.fillText(character.state.toUpperCase(), 332, 320)
  ;[['TOTAL THREADS', counts.total], ['MY TURN', counts.mine], ['THEIR TURN', counts.theirs]].forEach(([label, value], index) => { const x = 70 + index * 365; context.fillStyle = '#2d3a40'; context.fillRect(x, 410, 325, 145); context.fillStyle = '#a9d4dc'; context.font = '700 20px system-ui'; context.fillText(String(label), x + 24, 450); context.fillStyle = '#f8f3e9'; context.font = '600 64px Georgia'; context.fillText(String(value), x + 24, 525) })
  context.save(); context.beginPath(); context.arc(195, 275, 105, 0, Math.PI * 2); context.clip()
  if (character.iconObjectKey) {
    const blob = await fetch('/api/characters/' + character.id + '/icon').then(response => response.ok ? response.blob() : null)
    if (blob) { const url = URL.createObjectURL(blob), image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load icon')); image.src = url }); context.drawImage(image, 90, 170, 210, 210); URL.revokeObjectURL(url) }
  } else { context.fillStyle = '#a9d4dc'; context.fillRect(90, 170, 210, 210); context.fillStyle = '#182126'; context.font = '600 92px Georgia'; context.fillText(character.name.slice(0, 1).toUpperCase(), 160, 310) }
  context.restore(); context.strokeStyle = '#f8f3e9'; context.lineWidth = 7; context.beginPath(); context.arc(195, 275, 105, 0, Math.PI * 2); context.stroke()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('Could not export stats card')
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = (character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'character') + '-puffin-post-stats.png'; link.click(); URL.revokeObjectURL(url)
}

async function exportRpStats(group: Group, characters: Character[], counts: Record<string, Counts>) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Could not make an RP stats card')
  canvas.width = 1200; canvas.height = Math.max(460, 220 + characters.length * 132)
  context.fillStyle = '#182126'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#234e61'; context.fillRect(0, 0, canvas.width, 160)
  context.fillStyle = '#f8f3e9'; context.font = '700 28px system-ui'; context.fillText('PUFFIN POST  /  RP STATS', 70, 76)
  context.font = '600 66px Georgia'; context.fillText(group.name.slice(0, 30), 70, 135)
  context.font = '700 18px system-ui'; context.fillStyle = '#a9d4dc'; context.fillText(`${characters.length} CHARACTER${characters.length === 1 ? '' : 'S'}`, 920, 76)
  ;[['CHARACTER', 70], ['THREADS', 680], ['MY TURN', 840], ['THEIR TURN', 1010]].forEach(([label, x]) => { context.fillStyle = '#a9d4dc'; context.font = '700 18px system-ui'; context.fillText(String(label), Number(x), 205) })
  for (const [index, character] of characters.entries()) {
    const current = counts[character.id] ?? { total: 0, mine: 0, theirs: 0 }, y = 230 + index * 132
    context.fillStyle = index % 2 ? '#223037' : '#2d3a40'; context.fillRect(55, y, 1090, 102)
    context.save(); context.beginPath(); context.arc(106, y + 51, 28, 0, Math.PI * 2); context.clip()
    if (character.iconObjectKey) {
      const icon = await fetch('/api/characters/' + character.id + '/icon').then(response => response.ok ? response.blob() : null)
      if (icon) { const url = URL.createObjectURL(icon), image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load character icon')); image.src = url }); context.drawImage(image, 78, y + 23, 56, 56); URL.revokeObjectURL(url) }
    } else { context.fillStyle = '#a9d4dc'; context.fillRect(78, y + 23, 56, 56); context.fillStyle = '#182126'; context.font = '600 30px Georgia'; context.fillText(character.name.slice(0, 1).toUpperCase(), 96, y + 62) }
    context.restore(); context.strokeStyle = '#a9d4dc'; context.lineWidth = 2; context.beginPath(); context.arc(106, y + 51, 28, 0, Math.PI * 2); context.stroke()
    context.fillStyle = '#f8f3e9'; context.font = '600 34px Georgia'; context.fillText(character.name.slice(0, 27), 155, y + 61)
    ;[[current.total, 720], [current.mine, 885], [current.theirs, 1060]].forEach(([value, x]) => { context.font = '600 42px Georgia'; context.fillText(String(value), x, y + 65) })
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export RP stats')
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = (group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'rp') + '-puffin-post-stats.png'; link.click(); URL.revokeObjectURL(url)
}

function Quicklinks({ characterId }: { characterId: string }) {
  const [links, setLinks] = useState<{ id: string; label: string; url: string }[]>([]), [adding, setAdding] = useState(false), [error, setError] = useState('')
  const load = () => api<{ id: string; label: string; url: string }[]>('/characters/' + characterId + '/quicklinks').then(setLinks).catch(problem => setError(problem.message))
  useEffect(() => { void load() }, [characterId])
  return <section className="character-quicklinks"><div><strong>Quicklinks</strong><button type="button" className="text-button" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add link'}</button></div>{links.length > 0 ? <ul>{links.map(link => <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a><button type="button" className="text-button" onClick={() => void api('/characters/' + characterId + '/quicklinks/' + link.id, 'DELETE').then(load).catch(problem => setError(problem.message))}>Remove</button></li>)}</ul> : <p>Keep gif packs, icon pages, playlists, or reference links here.</p>}{adding && <form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); try { setError(''); await api('/characters/' + characterId + '/quicklinks', 'POST', { label: data.get('label'), url: data.get('url') }); form.reset(); setAdding(false); await load() } catch (problem) { setError((problem as Error).message) } }}><label>Label<input name="label" maxLength={120} required placeholder="gif pack" /></label><label>Link<input name="url" type="url" required placeholder="https://" /></label><button>Add quicklink</button></form>}{error && <p role="alert">{error}</p>}</section>
}

function ScrollableRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  const move = (direction: number) => row.current?.scrollBy({ left: direction * Math.max(260, row.current.clientWidth * .75), behavior: 'smooth' })
  return <div className="character-scroll-shell"><div className="character-scroll-controls"><button type="button" className="secondary-button" aria-label="Show previous characters" onClick={() => move(-1)}>←</button><button type="button" className="secondary-button" aria-label="Show more characters" onClick={() => move(1)}>→</button></div><div className="character-scroll-row" ref={row}>{children}</div></div>
}

function CharacterCard({ row, index, assignments, groups, stat, iconVersion, busy, addToGroup, upload, remove, returnToPlanner, showCreateGroup, reportError }: { row: Character; index?: number; assignments: Connection['assignments']; groups: Group[]; stat: Counts; iconVersion?: number; busy: boolean; addToGroup: (groupId: string, characterId: string) => Promise<void>; upload: (id: string, file: File) => Promise<void>; remove: (id: string) => Promise<void>; returnToPlanner:(id:string)=>Promise<void>; showCreateGroup: () => void; reportError: (error: string) => void }) {
  const characterAssignments = assignments.filter(assignment => assignment.characterId === row.id)
  const characterGroups = groups.filter(group => group.characterIds.includes(row.id))
  const availableGroups = groups.filter(group => !group.characterIds.includes(row.id))
  return <article className="character-card tracking-card" style={{'--i':index ?? 0} as CSSProperties}>
    <div className="character-card-top"><img className="character-avatar" alt="" src={row.iconObjectKey ? '/api/characters/' + row.id + '/icon?v=' + (iconVersion ?? row.iconObjectKey) : undefined} hidden={!row.iconObjectKey} onError={event => event.currentTarget.classList.add('avatar-fallback')} data-initials={initialsFor(row.name)} /><div><p className="eyebrow">{row.state}</p><h3>{row.name}</h3>{characterAssignments.length ? <p className="field-help"><strong>Tumblr assigned:</strong> {characterAssignments.map(assignment => blogLabel(assignment.blogIdentifier)).join(', ')}</p> : <p className="field-help">Next: <a href="#connections">assign Tumblr</a></p>}</div></div>
    <div className="character-rps"><strong>RP sections</strong>{characterGroups.length ? <span>{characterGroups.map(group => group.name).join(' / ')}</span> : <span>Not sorted yet</span>}{!characterGroups.length && availableGroups.length > 0 ? <label>Add {row.name} to an RP section<select className="character-rp-picker" value="" disabled={busy} onChange={event => { if (event.target.value) void addToGroup(event.target.value, row.id) }}><option value="">Add to RP.</option>{availableGroups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label> : !characterGroups.length ? <button type="button" className="text-button" onClick={showCreateGroup}>Create an RP</button> : null}</div>
    <div className="character-stats"><a href={'#inbox?characterId=' + row.id}><strong>{stat.total}</strong> thread{stat.total === 1 ? '' : 's'}</a><span><strong>{stat.mine}</strong> my turn</span><span><strong>{stat.theirs}</strong> their turn</span></div>
    <Quicklinks characterId={row.id} />
    <div className="character-actions"><label className="icon-picker">{row.iconObjectKey ? 'Replace icon' : 'Upload icon'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(row.id, file) }} /></label><button type="button" className="secondary-button" onClick={() => void exportCharacterCard(row, stat).catch(problem => reportError(problem.message))}>Export stats card</button></div>
    <div className="character-lifecycle"><button type="button" className="secondary-button" onClick={() => void returnToPlanner(row.id)}>Return to planner</button><button className="danger-button" type="button" onClick={() => void remove(row.id)}>Remove character</button></div>
  </article>
}

export default function CharactersPage() {
  const [rows, setRows] = useState<Character[]>(() => peekCache<Character[]>('/characters') ?? []), [assignments, setAssignments] = useState<Connection['assignments']>(() => (peekCache<Connection[]>('/connections') ?? []).flatMap(connection => connection.assignments)), [groups, setGroups] = useState<Group[]>(() => peekCache<Group[]>('/rp-groups') ?? []), [branches, setBranches] = useState<InboxBranch[]>(() => peekCache<{ branches: InboxBranch[] }>('/inbox')?.branches ?? [])
  const [error, setError] = useState(''), [adding, setAdding] = useState(false), [addingGroup, setAddingGroup] = useState(false), [busy, setBusy] = useState(false), [iconVersions, setIconVersions] = useState<Record<string, number>>({})
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; threads: number } | null>(null)
  const [deleteStep, setDeleteStep] = useState<'choose' | 'confirm'>('choose')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [loaded, setLoaded] = useState(() => ['/characters', '/connections', '/rp-groups', '/inbox'].every(path => peekCache(path) !== undefined))
  useEffect(() => { const t = window.setTimeout(() => { document.querySelector('.character-grid')?.setAttribute('data-entered', '') }, 700); return () => window.clearTimeout(t) }, [])
  const load = () => Promise.all([staleGet<Character[]>('/characters'), staleGet<Connection[]>('/connections'), staleGet<Group[]>('/rp-groups'), staleGet<{ branches: InboxBranch[] }>('/inbox')]).then(([characters, connections, nextGroups, inbox]) => { setRows(characters); setAssignments(connections.flatMap(connection => connection.assignments)); setGroups(nextGroups); setBranches(inbox.branches); setLoaded(true) }).catch(problem => { setError(problem.message); setLoaded(true) })
  useEffect(() => { void load() }, [])
  const counts = useMemo(() => Object.fromEntries(rows.map(character => { const current = branches.filter(branch => branch.characterId === character.id); return [character.id, { total: current.length, mine: current.filter(branch => branch.status === 'your_turn').length, theirs: current.filter(branch => branch.status === 'their_turn').length }] })), [rows, branches]) as Record<string, Counts>
  const groupedCharacters = useMemo(() => groups.map(group => ({ group, characters: rows.filter(row => group.characterIds.includes(row.id)) })).filter(section => section.characters.length > 0), [groups, rows])
  const unassignedCharacters = useMemo(() => rows.filter(row => !groups.some(group => group.characterIds.includes(row.id))), [groups, rows])
  async function upload(id: string, file: File) { try { setError(''); const form = new FormData(); form.set('icon', await squareIcon(file)); const response = await fetch('/api/characters/' + id + '/icon', { method: 'POST', body: form }); if (!response.ok) { const problem = await response.json().catch(() => null) as { error?: string } | null; throw new Error(problem?.error ?? 'Icon upload failed') } setIconVersions(current => ({ ...current, [id]: Date.now() })); await load() } catch (problem) { setError((problem as Error).message) } }
  async function addToGroup(groupId: string, characterId: string) { try { setBusy(true); setError(''); await api('/rp-groups/' + groupId + '/characters', 'POST', { characterId }); await load() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }
  async function remove(id: string) { const row = rows.find(r => r.id === id); if (!row) return; setDeleteTarget({ id, name: row.name, threads: counts[id]?.total ?? 0 }); setDeleteStep('choose') }
  async function archiveCharacter(id: string) { const row = rows.find(r => r.id === id); if (!row) return; try { setError(''); setDeleteBusy(true); await api('/characters/' + id + '/archive', 'POST'); setDeleteTarget(null); setDeleteStep('choose'); await load(); toast(`Archived ${row.name}.`, undoCharacterArchive(id)) } catch (problem) { setError((problem as Error).message) } finally { setDeleteBusy(false) } }
  async function confirmDelete() { if (!deleteTarget) return; try { setError(''); setDeleteBusy(true); await api('/characters/' + deleteTarget.id, 'DELETE'); setDeleteTarget(null); setDeleteStep('choose'); await load() } catch (problem) { setError((problem as Error).message) } finally { setDeleteBusy(false) } }
  async function returnToPlanner(id:string){const row=rows.find(r=>r.id===id);if(!row)return;try{setBusy(true);setError('');await api('/characters/'+id+'/return-to-planner','POST');toast('Moved '+row.name+' to the planner.',undoReturnToPlanner(id));await load();window.location.hash='planner'}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
  const card = (row: Character, index?: number) => <CharacterCard key={row.id} index={index} row={row} assignments={assignments} groups={groups} stat={counts[row.id] ?? { total: 0, mine: 0, theirs: 0 }} iconVersion={iconVersions[row.id]} busy={busy} addToGroup={addToGroup} upload={upload} remove={remove} returnToPlanner={returnToPlanner} showCreateGroup={() => setAddingGroup(true)} reportError={setError} />
  return <section aria-labelledby="page-title"><div className="character-page-heading"><div><h2 id="page-title" className="page-heading">Characters</h2><p className="page-description">Build your cast, connect their Tumblr, and place them in the RP spaces where they write.</p></div><div className="actions"><button onClick={() => setAddingGroup(!addingGroup)}>{addingGroup ? 'Close' : 'Add an RP'}</button><button onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add character'}</button></div></div>
    {error && <p role="alert">{error}</p>}
    {addingGroup && <form className="character-create tracking-card" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement, name = form ? new FormData(form).get('name') : null; try { setError(''); await api('/rp-groups', 'POST', { name }); if (form) form.reset(); setAddingGroup(false); await load() } catch (problem) { setError((problem as Error).message) } }}><label>RP name<input name="name" required maxLength={120} autoFocus placeholder="e.g. avast" /></label><button>Add RP</button></form>}
    {adding && <form className="character-create tracking-card" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement, name = form ? new FormData(form).get('name') : null; try { setError(''); await api('/characters', 'POST', { name, state: 'active' }); if (form) form.reset(); setAdding(false); await load() } catch (problem) { setError((problem as Error).message) } }}><label>Name<input name="name" required maxLength={200} autoFocus placeholder="Character name" /></label><button>Add to cast</button></form>}
    {!loaded ? (
      <div className="skeletons character-skeletons" aria-hidden="true">
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
        <div className="skeleton-card"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /><div className="skeleton-line skeleton-line-short" /></div></div>
      </div>
    ) : (
    <>
    {groupedCharacters.map(({ group, characters }) => <section className="character-rp-section" key={group.id} aria-labelledby={'rp-' + group.id}><div className="character-rp-heading"><div><p className="eyebrow">RP section</p><h3 id={'rp-' + group.id}>{group.name}</h3></div><div className="character-rp-actions"><span>{characters.length} {characters.length === 1 ? 'character' : 'characters'}</span>{characters.length > 1 && <button type="button" className="secondary-button" onClick={() => void exportRpStats(group, characters, counts).catch(problem => setError(problem.message))}>Export RP stats</button>}</div></div><ScrollableRow>{characters.map((row, index) => card(row, index))}</ScrollableRow></section>)}
    {unassignedCharacters.length > 0 && <section className="character-rp-section character-unsorted"><div className="character-rp-heading"><div><p className="eyebrow">Needs sorting</p><h3>Characters without an RP section</h3></div><span>{unassignedCharacters.length} {unassignedCharacters.length === 1 ? 'character' : 'characters'}</span></div><ScrollableRow>{unassignedCharacters.map((row, index) => card(row, index))}</ScrollableRow></section>}
    {!rows.length && <p>No characters yet. Add your first one above.</p>}
    </>
    )}
    {deleteTarget && (
      <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <div className="modal-card">
          {deleteStep === 'choose' ? (
            <>
              <h3 id="delete-dialog-title">What would you like to do with {deleteTarget.name}?</h3>
              <p className="page-description">Archiving keeps all threads, quicklinks, and RP memberships. Deleting removes everything permanently.</p>
              <div className="modal-actions">
                <button className="secondary-button" disabled={deleteBusy} onClick={() => void archiveCharacter(deleteTarget.id)}>{deleteBusy ? 'Working…' : 'Archive'}</button>
                <button className="danger-button" disabled={deleteBusy} onClick={() => setDeleteStep('confirm')}>Delete</button>
                <button className="text-button" onClick={() => { setDeleteTarget(null); setDeleteStep('choose') }}>Cancel</button>
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
                <button className="text-button" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); setDeleteStep('choose') }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
  </section>
}
