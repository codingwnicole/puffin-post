import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNativeDialog } from '../lib/dialog'
import { api, apiUpload, clearDraftLocal, restoreDraftLocal, saveDraftLocal } from '../lib/api'
import { IMAGE_ACCEPT, PORTRAIT_HINT } from '../lib/uploads'
import { CARD_SYMBOLS, SYMBOL_FONT, type CardSymbol } from '../../shared/card-symbols'
import TradingCard, { THEMES, normalizeCard, type CardProfile, type CardStats, type ThemeId } from './TradingCard'

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null; portraitObjectKey: string | null; card?: CardProfile | null }
type MoodItem = { id: string; kind: 'image' | 'pin' }

function CardEditor({ row, stats, portrait, upload, close, saved }: { row: Character; stats: CardStats; portrait: string | null; upload: (file: File) => Promise<void>; close: () => void; saved: () => Promise<void> }) {
  const draftKey = `card:${row.id}`
  const [draft, setDraft] = useState<CardProfile>(() => { const start = normalizeCard(row.card); try { const saved = restoreDraftLocal(draftKey); return saved ? normalizeCard(JSON.parse(saved) as Partial<CardProfile>) : { ...start, facts: [0, 1, 2, 3, 4].map(i => start.facts[i] ?? '') } } catch { return start } })
  const [tab, setTab] = useState<'front' | 'back' | 'board'>('front')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [moodItems, setMoodItems] = useState<MoodItem[]>([])
  const [moodBusy, setMoodBusy] = useState(false)
  const [portraitBusy, setPortraitBusy] = useState(false)
  const set = <K extends keyof CardProfile>(key: K, value: CardProfile[K]) => setDraft(current => ({ ...current, [key]: value }))
  // Escape and Cancel used to drop every unsaved edit silently. Ask first when the card changed.
  const [initial] = useState(() => JSON.stringify(normalizeCard(row.card)))
  const dirty = JSON.stringify(draft) !== initial
  const dialogRef = useRef<HTMLDialogElement>(null)
  const moodPinRef = useRef<HTMLInputElement>(null)
  useNativeDialog(dialogRef)
  const finishClose = () => { dialogRef.current?.close(); close() }
  const requestClose = () => { if (!dirty || window.confirm('Discard your unsaved changes to this card?')) { clearDraftLocal(draftKey); finishClose() } }
  useEffect(() => { let active = true; void api<MoodItem[]>('/characters/' + row.id + '/moodboard').then(items => { if (active) setMoodItems(items) }).catch(() => {}); return () => { active = false } }, [row.id])
  useEffect(() => { saveDraftLocal(draftKey, JSON.stringify(draft)) }, [draftKey, draft])
  const moodUrls = moodItems.filter(i => i.kind === 'image').map(i => '/api/characters/' + row.id + '/moodboard/' + i.id + '/image')
  const addMoodImage = async (file: File) => { try { setMoodBusy(true); const form = new FormData(); form.set('image', file); const item = await apiUpload<MoodItem>('/characters/' + row.id + '/moodboard', form); setMoodItems(prev => [...prev, item]) } catch (problem) { setError((problem as Error).message) } finally { setMoodBusy(false) } }
  const addMoodPin = async (url: string) => { try { setMoodBusy(true); const item = await api<MoodItem>('/characters/' + row.id + '/moodboard/pin', 'POST', { url }); setMoodItems(prev => [...prev, item]) } catch (problem) { setError((problem as Error).message) } finally { setMoodBusy(false) } }
  const removeMoodItem = async (itemId: string) => { try { setMoodBusy(true); await api('/characters/' + row.id + '/moodboard/' + itemId, 'DELETE'); setMoodItems(prev => prev.filter(i => i.id !== itemId)) } catch (problem) { setError((problem as Error).message) } finally { setMoodBusy(false) } }
  const lookupSong = async (url: string) => { try { const r = await api<{song:string;artist:string}>('/characters/song-lookup?url=' + encodeURIComponent(url)); if (r.song) { set('song', r.song); set('artist', r.artist || '') } } catch { /* keep whatever the user pasted */ } }
  const field = (key: 'nickname' | 'age' | 'birthdate' | 'song', label: string, max: number) => <label>{label}<input value={draft[key]} maxLength={max} onChange={event => set(key, event.target.value)} {...(key === 'song' ? { onPaste: (event: React.ClipboardEvent) => { const text = event.clipboardData.getData('text').trim(); if (/^https?:\/\//.test(text)) { event.preventDefault(); void lookupSong(text) } } } : {})} /></label>
  return <dialog ref={dialogRef} className="rd-dialog rd-card-editor-dialog" aria-labelledby="card-editor-title" onCancel={event => { event.preventDefault(); requestClose() }}>
    <form className="rd-card-editor" onSubmit={async event => { event.preventDefault(); try { setSaving(true); setError(''); await api('/characters/' + row.id + '/card', 'PUT', { ...draft, facts: draft.facts.map(fact => fact.trim()).filter(Boolean), tracklist: draft.tracklist.map(song => song.trim()).filter(Boolean).slice(0, 10) }); clearDraftLocal(draftKey); await saved(); finishClose() } catch (problem) { setError((problem as Error).message) } finally { setSaving(false) } }}>
      <div className="rd-card-editor-main">
        <div className="rd-dialog-heading"><div><h2 id="card-editor-title">{row.name}'s trading card</h2><p>Keep the character icon separate. Card portraits can be larger, and GIFs stay animated.</p></div><button type="button" className="secondary-button" onClick={requestClose}>Close</button></div>
        <div className="rd-editor-tabs" role="tablist" aria-label="Card details">
          <button type="button" role="tab" id="card-tab-front" aria-controls="card-panel-front" aria-selected={tab === 'front'} onClick={() => setTab('front')}>Front</button>
          <button type="button" role="tab" id="card-tab-back" aria-controls="card-panel-back" aria-selected={tab === 'back'} onClick={() => setTab('back')}>Back</button>
          <button type="button" role="tab" id="card-tab-board" aria-controls="card-panel-board" aria-selected={tab === 'board'} onClick={() => setTab('board')}>Playlist &amp; board</button>
        </div>
        <section id="card-panel-front" className="rd-editor-panel" role="tabpanel" aria-labelledby="card-tab-front" hidden={tab !== 'front'}>
          <fieldset className="card-theme-picker"><legend>Card theme</legend>{(Object.keys(THEMES) as ThemeId[]).map(id => <label key={id} style={{ '--swatch': `linear-gradient(135deg, ${THEMES[id].bg[0]}, ${THEMES[id].foil[1]})` } as CSSProperties}><input type="radio" name="theme" value={id} checked={draft.theme === id} onChange={() => set('theme', id)} /><span>{THEMES[id].label}<small>{THEMES[id].group}</small></span></label>)}</fieldset>
          <fieldset className="card-symbol-picker"><legend>Symbol by the name</legend>{(Object.keys(CARD_SYMBOLS) as CardSymbol[]).map(key => <label key={key} title={CARD_SYMBOLS[key].label}><input type="radio" name="symbol" value={key} checked={(draft.symbol ?? 'none') === key} onChange={() => set('symbol', key)} aria-label={CARD_SYMBOLS[key].label} /><span aria-hidden="true" style={{ fontFamily: SYMBOL_FONT }}>{CARD_SYMBOLS[key].glyph || 'None'}</span></label>)}</fieldset>
          <label className="icon-picker">{portraitBusy ? 'Uploading.' : portrait ? 'Replace portrait' : 'Upload portrait'}<input type="file" accept={IMAGE_ACCEPT} aria-describedby="portrait-hint" disabled={saving || portraitBusy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { setPortraitBusy(true); void upload(file).catch(problem => setError((problem as Error).message)).finally(() => setPortraitBusy(false)) } }} /></label><p className="field-help" id="portrait-hint">{PORTRAIT_HINT} This image is separate from your character's icon.</p>
          <div className="card-editor-row">{field('nickname', 'Name on card', 60)}{field('age', 'Age', 30)}{field('birthdate', 'Birthdate', 40)}</div>
          <label>Quote<textarea value={draft.quote} maxLength={160} rows={3} onChange={event => set('quote', event.target.value)} /></label>
          <div className="card-editor-row"><label>Theme song<input value={draft.song} maxLength={120} placeholder="Song title or a link" onChange={event => set('song', event.target.value)} onBlur={event => { const url = event.currentTarget.value.trim(); if (/^https?:\/\//.test(url)) void lookupSong(url) }} onPaste={event => { const text = event.clipboardData.getData('text').trim(); if (/^https?:\/\//.test(text)) { event.preventDefault(); void lookupSong(text) } }} /><span className="field-help">Paste a Spotify, YouTube, or Apple Music link to fill both fields.</span></label><label>Artist<input value={draft.artist} maxLength={120} placeholder="Artist" onChange={event => set('artist', event.target.value)} /></label><label>Favorite color<span className="color-combo"><input type="color" value={draft.favoriteColor} onChange={event => set('favoriteColor', event.target.value)} /><input type="text" className="color-hex" value={draft.favoriteColor} maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={event => { const v = event.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) set('favoriteColor', v); else setDraft(d => ({ ...d, favoriteColor: v })) }} onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(draft.favoriteColor)) set('favoriteColor', '#b07a9e') }} /></span></label></div>
        </section>
        <section id="card-panel-back" className="rd-editor-panel" role="tabpanel" aria-labelledby="card-tab-back" hidden={tab !== 'back'}>
          <fieldset><legend>Fun facts</legend>{draft.facts.map((fact, i) => <label key={i}>Fun fact {i + 1}<input value={fact} maxLength={70} onChange={event => set('facts', draft.facts.map((current, j) => j === i ? event.target.value : current))} /></label>)}</fieldset>
          <div className="card-editor-row"><label>Likes<input value={draft.likes} maxLength={90} onChange={event => set('likes', event.target.value)} /></label><label>Dislikes<input value={draft.dislikes} maxLength={90} onChange={event => set('dislikes', event.target.value)} /></label></div>
          <label>Notes<textarea value={draft.notes} maxLength={140} rows={4} onChange={event => set('notes', event.target.value)} /></label>
        </section>
        <section id="card-panel-board" className="rd-editor-panel" role="tabpanel" aria-labelledby="card-tab-board" hidden={tab !== 'board'}>
          <label>Playlist link<input value={draft.playlistUrl} maxLength={500} placeholder="https://open.spotify.com/playlist/." onChange={event => set('playlistUrl', event.target.value)} /><span className="field-help">Spotify, YouTube, YouTube Music, or Apple Music</span></label>
          <label>Pinterest board<input value={draft.boardUrl} maxLength={500} placeholder="https://pin.it/. or a board URL" onChange={event => set('boardUrl', event.target.value)} /></label>
          <label>Track list<textarea value={draft.tracklist.join('\n')} rows={4} placeholder="One song per line (up to 10)" onChange={event => set('tracklist', event.target.value.split('\n').slice(0, 10))} /></label>
          <div className="mood-section-label">Moodboard images <small>({moodItems.length}/12)</small></div>
          <div className="mood-grid">{moodItems.map(item => <div key={item.id} className="mood-thumb">{item.kind === 'image' ? <img src={'/api/characters/' + row.id + '/moodboard/' + item.id + '/image'} alt="" /> : <span className="mood-pin-icon" title="Pinterest pin">Pinterest pin</span>}<button type="button" className="mood-remove" aria-label="Remove moodboard item" disabled={moodBusy} onClick={() => void removeMoodItem(item.id)}>Remove</button></div>)}</div>
          {moodItems.length < 12 && <div className="mood-add"><label className="icon-picker">{moodBusy ? 'Uploading.' : 'Add image'}<input type="file" accept={IMAGE_ACCEPT} disabled={moodBusy || saving} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void addMoodImage(file); event.currentTarget.value = '' }} /></label><details className="mood-pin-toggle"><summary className="text-button">Or add a Pinterest pin by URL</summary><form className="mood-pin-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); const url = moodPinRef.current?.value.trim(); if (url) void addMoodPin(url).then(() => { if (moodPinRef.current) moodPinRef.current.value = '' }) }}><label className="sr-only" htmlFor="mood-pin-url">Pinterest pin URL</label><input ref={moodPinRef} id="mood-pin-url" type="url" placeholder="https://pin.it/." /><button type="submit" disabled={moodBusy} className="secondary-button">Add</button></form></details></div>}
          <p className="field-help">Your card keeps 12 moodboard items, then the tracklist and full board link.</p>
        </section>
        {error && <p role="alert">{error}</p>}
        <div className="rd-editor-actions"><button className="rd-button-primary" disabled={saving}>{saving ? 'Saving.' : 'Save card'}</button><button type="button" className="secondary-button" onClick={requestClose}>Cancel</button><button type="button" className="text-button danger-text" disabled={saving} onClick={async () => { if (!window.confirm('Delete this card? The character stays, only the card is removed.')) return; try { setSaving(true); await api('/characters/' + row.id + '/card', 'DELETE'); clearDraftLocal(draftKey); await saved(); finishClose() } catch (problem) { setError((problem as Error).message) } finally { setSaving(false) } }}>Delete card</button></div>
      </div>
      <aside className="rd-editor-preview"><TradingCard name={row.name} profile={draft} stats={stats} portrait={portrait} moodboard={moodUrls} initialSide="back" /><p className="field-help">Tap the card to flip it. Thread stats fill in on their own.</p></aside>
    </form>
  </dialog>
}

export default CardEditor
