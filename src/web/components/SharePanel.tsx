import { useEffect, useRef, useState } from 'react'
import { useNativeDialog } from '../lib/dialog'
import { api, apiUpload } from '../lib/api'
import { cardPreviewBlob, type CardStats } from './TradingCard'
import { statsCardBlob } from '../lib/stats-card'

type ShareSettings = { slug: string; style: 'card' | 'stats'; showMoodboard: boolean; showPlaylist: boolean; showStats: boolean; indexable: boolean; hasPreview: boolean; url: string } | null
type Character = { id: string; name: string; state: string; iconObjectKey: string | null }
type Counts = { total: number; mine: number; theirs: number }

async function uploadPreview(characterId: string, blob: Blob) {
  const form = new FormData()
  form.append('image', new File([blob], 'preview.png', { type: 'image/png' }))
  await apiUpload(`/characters/${characterId}/share/preview`, form)
}

export default function SharePanel({ character, counts, stats, cardRef, close, onChanged }: {
  character: Character
  counts: Counts
  stats: CardStats
  cardRef: React.RefObject<Element | null>
  close: () => void
  onChanged?: () => void
}) {
  const [share, setShare] = useState<ShareSettings | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const [style, setStyle] = useState<'card' | 'stats'>('card')
  const [indexable, setIndexable] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useNativeDialog(dialogRef)
  const dismiss = () => { dialogRef.current?.close(); close() }

  useEffect(() => {
    api<ShareSettings>(`/characters/${character.id}/share`).then(data => {
      setShare(data)
      if (data) { setStyle(data.style); setIndexable(data.indexable) }
    }).catch(problem => setError((problem as Error).message)).finally(() => setLoading(false))
  }, [character.id])

  const renderAndUploadPreview = async (currentStyle: 'card' | 'stats', currentShowStats: boolean) => {
    const blob = currentStyle === 'card' && cardRef.current
      ? await cardPreviewBlob(cardRef.current)
      : await statsCardBlob(character, currentShowStats ? counts : { total: 0, mine: 0, theirs: 0 })
    await uploadPreview(character.id, blob)
  }

  // Card edits deliberately clear an old social-preview PNG. Rebuild it from the live card when
  // the owner next opens Share, including older cards that were created before this system existed.
  useEffect(() => {
    if (loading || saving || !share || share.hasPreview || !cardRef.current) return
    void renderAndUploadPreview(share.style, share.showStats).then(() => {
      setShare(current => current ? { ...current, hasPreview: true } : current)
    }).catch(problem => setError((problem as Error).message))
  }, [loading, saving, share?.slug, share?.hasPreview, cardRef])

  const save = async () => {
    setSaving(true); setError('')
    try {
      const body = { style, showMoodboard: true, showPlaylist: true, showStats: true, indexable }
      const result = await api<NonNullable<ShareSettings>>(`/characters/${character.id}/share`, 'PUT', body)
      setShare(result)
      await renderAndUploadPreview(style, true)
      setShare(current => current ? { ...current, hasPreview: true } : current)
      onChanged?.()
    } catch (problem) { setError((problem as Error).message) }
    finally { setSaving(false) }
  }

  const toggleSharing = async () => {
    if (share) {
      if (!window.confirm('The share link will stop working. Turn off sharing?')) return
      setSaving(true); setError('')
      try { await api(`/characters/${character.id}/share`, 'DELETE'); setShare(null); onChanged?.() }
      catch (problem) { setError((problem as Error).message) }
      finally { setSaving(false) }
    } else {
      await save()
    }
  }

  const rotateSlug = async () => {
    if (!window.confirm('The old link will stop working.')) return
    setSaving(true); setError('')
    try {
      const result = await api<{ slug: string; url: string }>(`/characters/${character.id}/share/rotate`, 'POST')
      setShare(prev => prev ? { ...prev, slug: result.slug, url: result.url } : prev)
    } catch (problem) { setError((problem as Error).message) }
    finally { setSaving(false) }
  }

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 2000) } catch { /* clipboard may not be available */ }
  }

  const origin = share?.url ? new URL(share.url).origin : 'https://rpthreadbuddy.app'
  const slug = share?.slug ?? ''
  const pageUrl = `${origin}/c/${slug}`

  const snippets = share ? [
    { label: 'Link', value: pageUrl, hint: 'Paste anywhere. Discord, Tumblr and iMessage show a preview picture.' },
    { label: 'Image + link (HTML)', value: `<a href="${pageUrl}"><img src="${pageUrl}/card.png" alt="${character.name} on RP Thread Buddy" width="440"></a>`, hint: 'Tumblr posts (HTML editor), Tumblr bio or theme, carrd Image or Embed element, AO3 and most sites. Tumblr copies the picture into the post, so it won\'t update later.' },
    { label: 'BBCode', value: `[url=${pageUrl}][img]${pageUrl}/card.png[/img][/url]`, hint: 'Forums like JCink and ProBoards.' },
    { label: 'Markdown', value: `[![${character.name}](${pageUrl}/card.png)](${pageUrl})`, hint: 'Reddit, Notion, GitHub and other Markdown editors.' },
    { label: 'Interactive card (iframe)', value: style === 'card'
      ? `<iframe src="${pageUrl}/embed" width="340" height="480" style="border:0" title="${character.name} on RP Thread Buddy" loading="lazy"></iframe>`
      : `<iframe src="${pageUrl}/embed" width="480" height="260" style="border:0" title="${character.name} on RP Thread Buddy" loading="lazy"></iframe>`,
      hint: 'Flippable card for carrd (Embed element, Pro plan), personal websites and custom Tumblr themes. Doesn\'t work in Tumblr posts or Discord; use the link or image there.' },
  ] : []

  return <dialog ref={dialogRef} className="modal-overlay" aria-labelledby="share-panel-title" onCancel={event => { event.preventDefault(); dismiss() }} onClick={event => { if (event.target === event.currentTarget) dismiss() }}>
    <div className="modal-card share-panel">
      <h2 id="share-panel-title">Share {character.name}</h2>
      {loading ? <p>Loading…</p> : <>
        <label className="share-toggle">
          <input type="checkbox" checked={!!share} onChange={toggleSharing} disabled={saving} />
          Share this character publicly
        </label>

        {share && <>
          <fieldset className="share-style">
            <legend>Style</legend>
            <label><input type="radio" name="share-style" value="card" checked={style === 'card'} onChange={() => setStyle('card')} /> Trading card</label>
            <label><input type="radio" name="share-style" value="stats" checked={style === 'stats'} onChange={() => setStyle('stats')} /> Simple card (icon, name, stats)</label>
          </fieldset>

          <fieldset className="share-options">
            <legend>Options</legend>
            <label><input type="checkbox" checked={indexable} onChange={e => setIndexable(e.target.checked)} /> Let search engines show this page</label>
            <p className="share-hint">Off asks search engines not to show the page; updates can take time. Anyone with the link can still open it. Playlist, moodboard and stats show automatically when you've filled them in on the card.</p>
          </fieldset>

          <div className="share-actions">
            <button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
            <button type="button" className="text-button" onClick={rotateSlug} disabled={saving}>New link</button>
            <a href={pageUrl} target="_blank" rel="noopener noreferrer">Preview</a>
          </div>

          <section className="share-snippets">
            <h3>Embed snippets</h3>
            {snippets.map(s => <div key={s.label} className="share-snippet">
              <div className="share-snippet-head">
                <strong>{s.label}</strong>
                <button type="button" onClick={() => copy(s.value, s.label)}>{copied === s.label ? 'Copied' : 'Copy'}</button>
              </div>
              <input type="text" readOnly value={s.value} onFocus={e => e.target.select()} />
              <p className="share-hint">{s.hint}</p>
            </div>)}
          </section>
        </>}

        {error && <p className="share-error" role="alert">{error}</p>}
        <button type="button" className="text-button" onClick={dismiss}>Close</button>
      </>}
    </div>
  </dialog>
}
