import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { IMAGE_ACCEPT, PORTRAIT_HINT } from '../lib/uploads'
import { CARD_SYMBOLS, SYMBOL_FONT, type CardSymbol } from '../../shared/card-symbols'
import TradingCard, { THEMES, type CardProfile, type CardStats, type ThemeId, emptyCard } from './TradingCard'

type Character = { id: string; name: string; color: string | null; state: string; notes: string | null; iconObjectKey: string | null; portraitObjectKey: string | null; card?: CardProfile | null }
type MoodItem = { id: string; kind: 'image' | 'pin' }

function CardEditor({ row, stats, portrait, upload, close, saved }: { row: Character; stats: CardStats; portrait: string | null; upload: (file: File) => Promise<void>; close: () => void; saved: () => Promise<void> }) {
  const [draft, setDraft] = useState<CardProfile>(() => { const start = { ...emptyCard(), ...row.card }; return { ...start, facts: [0, 1, 2, 3, 4].map(i => start.facts[i] ?? ''), tracklist: start.tracklist ?? [] } })
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [moodItems, setMoodItems] = useState<MoodItem[]>([])
  const [moodBusy, setMoodBusy] = useState(false)
  const set = <K extends keyof CardProfile>(key: K, value: CardProfile[K]) => setDraft(current => ({ ...current, [key]: value }))
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [close])
  useEffect(() => { void api<MoodItem[]>('/characters/' + row.id + '/moodboard').then(setMoodItems).catch(() => {}) }, [row.id])
  const moodUrls = moodItems.filter(i => i.kind === 'image').map(i => '/api/characters/' + row.id + '/moodboard/' + i.id + '/image')
  const addMoodImage = async (file: File) => { try { setMoodBusy(true); const form = new FormData(); form.set('image', file); const item = await fetch('/api/characters/' + row.id + '/moodboard', { method: 'POST', body: form }).then(r => { if (!r.ok) throw new Error('Upload failed'); return r.json() }) as MoodItem; setMoodItems(prev => [...prev, item]) } catch (problem) { setError((problem as Error).message) } finally { setMoodBusy(false) } }
  const addMoodPin = async (url: string) => { try { setMoodBusy(true); const item = await api<MoodItem>('/characters/' + row.id + '/moodboard/pin', 'POST', { url }); setMoodItems(prev => [...prev, item]) } catch (problem) { setError((problem as Error).message) } finally { setMoodBusy(false) } }
  const removeMoodItem = async (itemId: string) => { try { await api('/characters/' + row.id + '/moodboard/' + itemId, 'DELETE'); setMoodItems(prev => prev.filter(i => i.id !== itemId)) } catch (problem) { setError((problem as Error).message) } }
  const lookupSong = async (url: string) => { try { const r = await api<{song:string;artist:string}>('/characters/song-lookup?url=' + encodeURIComponent(url)); if (r.song) set('song', r.artist ? r.song + ' — ' + r.artist : r.song) } catch { /* keep whatever the user pasted */ } }
  const field = (key: 'nickname' | 'age' | 'birthdate' | 'song', label: string, max: number) => <label>{label}<input value={draft[key]} maxLength={max} onChange={event => set(key, event.target.value)} {...(key === 'song' ? { onPaste: (event: React.ClipboardEvent) => { const text = event.clipboardData.getData('text').trim(); if (/^https?:\/\//.test(text)) { event.preventDefault(); void lookupSong(text) } } } : {})} /></label>
  return createPortal(<div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="card-editor-title">
    <form className="modal-card card-editor" onSubmit={async event => { event.preventDefault(); try { setSaving(true); setError(''); await api('/characters/' + row.id + '/card', 'PUT', { ...draft, facts: draft.facts.map(fact => fact.trim()).filter(Boolean), tracklist: draft.tracklist.map(song => song.trim()).filter(Boolean).slice(0, 10) }); await saved(); close() } catch (problem) { setError((problem as Error).message) } finally { setSaving(false) } }}>
      <div className="card-editor-fields">
        <h2 id="card-editor-title">{row.name}'s trading card</h2>
        <fieldset className="card-theme-picker"><legend>Style</legend>{(Object.keys(THEMES) as ThemeId[]).map(id => <label key={id} style={{ '--swatch': `linear-gradient(135deg, ${THEMES[id].bg[0]}, ${THEMES[id].foil[1]})` } as CSSProperties}><input type="radio" name="theme" value={id} checked={draft.theme === id} onChange={() => set('theme', id)} /><span>{THEMES[id].label}<small>{THEMES[id].group}</small></span></label>)}</fieldset>
        <fieldset className="card-symbol-picker"><legend>Symbol by the name</legend>{(Object.keys(CARD_SYMBOLS) as CardSymbol[]).map(key => <label key={key} title={CARD_SYMBOLS[key].label}><input type="radio" name="symbol" value={key} checked={(draft.symbol ?? 'none') === key} onChange={() => set('symbol', key)} aria-label={CARD_SYMBOLS[key].label} /><span aria-hidden="true" style={{ fontFamily: SYMBOL_FONT }}>{CARD_SYMBOLS[key].glyph || 'None'}</span></label>)}</fieldset>
        <label className="icon-picker">{portrait ? 'Replace portrait' : 'Upload portrait'}<input type="file" accept={IMAGE_ACCEPT} aria-describedby="portrait-hint" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file).catch(problem => setError((problem as Error).message)) }} /></label><p className="field-help" id="portrait-hint">{PORTRAIT_HINT} This image is separate from your character's icon.</p>
        <div className="card-editor-row">{field('nickname', 'Name on card', 60)}{field('age', 'Age', 30)}{field('birthdate', 'Birthdate', 40)}</div>
        <label>Quote<textarea value={draft.quote} maxLength={160} rows={2} onChange={event => set('quote', event.target.value)} /></label>
        <div className="card-editor-row"><label>Theme song<input value={draft.song} maxLength={120} placeholder="Song — Artist" onChange={event => set('song', event.target.value)} onPaste={event => { const text = event.clipboardData.getData('text').trim(); if (/^https?:\/\//.test(text)) { event.preventDefault(); void lookupSong(text) } }} /><span className="field-help">Paste a Spotify, YouTube, or Apple Music link to auto-fill title and artist.</span></label><label>Favorite color<span className="color-combo"><input type="color" value={draft.favoriteColor} onChange={event => set('favoriteColor', event.target.value)} /><input type="text" className="color-hex" value={draft.favoriteColor} maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={event => { const v = event.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) set('favoriteColor', v); else setDraft(d => ({ ...d, favoriteColor: v })) }} onBlur={() => { if (!/^#[0-9a-fA-F]{6}$/.test(draft.favoriteColor)) set('favoriteColor', '#b07a9e') }} /></span></label></div>
        <fieldset><legend>Fun facts</legend>{draft.facts.map((fact, i) => <input key={i} aria-label={`Fun fact ${i + 1}`} value={fact} maxLength={70} onChange={event => set('facts', draft.facts.map((current, j) => j === i ? event.target.value : current))} />)}</fieldset>
        <div className="card-editor-row"><label>Likes<input value={draft.likes} maxLength={90} onChange={event => set('likes', event.target.value)} /></label><label>Dislikes<input value={draft.dislikes} maxLength={90} onChange={event => set('dislikes', event.target.value)} /></label></div>
        <label>Notes<textarea value={draft.notes} maxLength={140} rows={2} onChange={event => set('notes', event.target.value)} /></label>
        <fieldset><legend>Moodboard <small>({moodItems.length}/12)</small></legend>
          <div className="mood-grid">{moodItems.map(item => <div key={item.id} className="mood-thumb">{item.kind === 'image' ? <img src={'/api/characters/' + row.id + '/moodboard/' + item.id + '/image'} alt="" /> : <span className="mood-pin-icon" title="Pinterest pin">📌</span>}<button type="button" className="mood-remove" aria-label="Remove" onClick={() => void removeMoodItem(item.id)}>×</button></div>)}</div>
          {moodItems.length < 12 && <div className="mood-add"><label className="icon-picker">{moodBusy ? 'Uploading…' : 'Add image'}<input type="file" accept={IMAGE_ACCEPT} disabled={moodBusy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void addMoodImage(file); event.currentTarget.value = '' }} /></label><form className="mood-pin-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); const input = event.currentTarget.querySelector('input') as HTMLInputElement; if (input.value.trim()) void addMoodPin(input.value.trim()).then(() => { input.value = '' }) }}><input placeholder="Pinterest pin URL" /><button type="submit" disabled={moodBusy} className="secondary-button">Add pin</button></form></div>}
          <p className="field-help">Images and Pinterest pins for the card's third face. Tap the card preview to see it.</p>
        </fieldset>
        <label>Playlist link<input value={draft.playlistUrl} maxLength={500} placeholder="https://open.spotify.com/playlist/…" onChange={event => set('playlistUrl', event.target.value)} /><span className="field-help">Spotify, YouTube, YouTube Music, or Apple Music</span></label>
        <label>Pinterest board link<input value={draft.boardUrl} maxLength={500} placeholder="https://pin.it/… or a board URL" onChange={event => set('boardUrl', event.target.value)} /></label>
        <label>Track list<textarea value={draft.tracklist.join('\n')} rows={4} placeholder="One song per line (up to 10)" onChange={event => set('tracklist', event.target.value.split('\n').slice(0, 10))} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions"><button disabled={saving}>{saving ? 'Saving…' : 'Save card'}</button><button type="button" className="text-button" onClick={close}>Cancel</button><button type="button" className="text-button danger-text" disabled={saving} onClick={async () => { if (!confirm('Delete this card? The character stays, only the card is removed.')) return; try { setSaving(true); await api('/characters/' + row.id + '/card', 'DELETE'); await saved(); close() } catch (problem) { setError((problem as Error).message) } finally { setSaving(false) } }}>Delete card</button></div>
      </div>
      <div className="card-editor-preview"><TradingCard name={row.name} profile={draft} stats={stats} portrait={portrait} moodboard={moodUrls} /><p className="field-help">Tap the card to flip it. Thread stats fill in on their own.</p></div>
    </form>
  </div>, document.body)
}

export default CardEditor
