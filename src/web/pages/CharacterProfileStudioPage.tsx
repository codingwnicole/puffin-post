import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { characterProfileSchema, emptyCharacterProfile, PROFILE_SECTION_LABELS, type CharacterProfile, type ProfileSection } from '../../shared/character-profile'

type QuizSource = { id: string; title: string; sourceUrl: string; category: string; description: string; tags: string[] }
type QuizResult = { id: string; quizSourceId: string | null; quizTitle: string | null; sourceUrl: string | null; resultTitle: string; resultText: string; notes: string; completedAt: string; visibility: 'private' | 'public' }
type StudioData = { character: { id: string; name: string; card: { nickname?: string } | null }; draft: unknown; share: { slug: string; url: string; publishedAt: string | null } | null; quizSources: QuizSource[]; quizResults: QuizResult[]; quicklinks: Array<{ id: string; label: string; url: string }> }

const lines = (value: string) => value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
const lineText = (values: string[]) => values.join('\n')
const dateInput = () => new Date().toISOString().slice(0, 10)

export default function CharacterProfileStudioPage({ id }: { id: string }) {
  const [data, setData] = useState<StudioData | null>(null)
  const [profile, setProfile] = useState<CharacterProfile>(() => emptyCharacterProfile())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sourceForm, setSourceForm] = useState({ title: '', sourceUrl: '', category: '', description: '', tagsText: '' })
  const [resultForm, setResultForm] = useState({ id: '', quizSourceId: '', resultTitle: '', resultText: '', notes: '', completedAt: dateInput(), visibility: 'private' as 'private' | 'public' })

  async function reload() {
    const result = await api<StudioData>(`/character-profiles/${id}`)
    setData(result)
    setProfile(characterProfileSchema.parse(result.draft ?? {}))
  }
  useEffect(() => { let active = true; void api<StudioData>(`/character-profiles/${id}`).then(result => { if (active) { setData(result); setProfile(characterProfileSchema.parse(result.draft ?? {})) } }).catch(problem => { if (active) setError((problem as Error).message) }); return () => { active = false } }, [id])

  const title = data?.character.card?.nickname?.trim() || data?.character.name || 'Character profile'
  const setModule = <K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K]) => setProfile(current => ({ ...current, [key]: value }))
  const previewSections = useMemo(() => {
    const sections: Array<[string, string]> = []
    if (profile.introduction.enabled && profile.introduction.text.trim()) sections.push(['Introduction', profile.introduction.text])
    if (profile.biography.enabled && profile.biography.text.trim()) sections.push(['Biography', profile.biography.text])
    if (profile.basics.enabled) sections.push([PROFILE_SECTION_LABELS.basics, [profile.basics.pronouns, profile.basics.age, profile.basics.birthday, profile.basics.occupation, profile.basics.location].filter(Boolean).join(' · ')])
    if (profile.personality.enabled) sections.push([PROFILE_SECTION_LABELS.personality, [profile.personality.summary, ...profile.personality.traits].filter(Boolean).join('\n')])
    if (profile.relationships.enabled && profile.relationships.entries.length) sections.push(['Relationships', lineText(profile.relationships.entries)])
    if (profile.quotes.enabled && profile.quotes.entries.length) sections.push(['Quotes', lineText(profile.quotes.entries)])
    if (profile.songs.enabled && profile.songs.entries.length) sections.push(['Theme songs', lineText(profile.songs.entries)])
    if (profile.trivia.enabled && profile.trivia.entries.length) sections.push(['Trivia & headcanons', lineText(profile.trivia.entries)])
    if (profile.social.enabled && (profile.social.bio || profile.social.posts.length)) sections.push([PROFILE_SECTION_LABELS.social, [profile.social.bio, ...profile.social.posts].filter(Boolean).join('\n')])
    if (profile.quizzes.enabled && data?.quizResults.some(item => item.visibility === 'public')) sections.push(['Quizzes & results', data.quizResults.filter(item => item.visibility === 'public').map(item => item.resultTitle).join('\n')])
    if (profile.quicklinks.enabled && data?.quicklinks.length) sections.push([PROFILE_SECTION_LABELS.quicklinks, data.quicklinks.map(item => item.label).join(' · ')])
    const keyByHeading: Record<string, ProfileSection> = Object.fromEntries(Object.entries(PROFILE_SECTION_LABELS).map(([key, label]) => [label, key as ProfileSection]))
    return sections.sort((a, b) => profile.sectionOrder.indexOf(keyByHeading[a[0]]) - profile.sectionOrder.indexOf(keyByHeading[b[0]]))
  }, [profile, data])

  async function saveDraft(publish = false) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const normalized = characterProfileSchema.parse(profile)
      await api(`/character-profiles/${id}/draft`, 'PUT', normalized)
      if (publish) {
        const result = await api<{ url: string; publishedAt: string }>(`/character-profiles/${id}/publish`, 'POST')
        setMessage(`Profile published: ${result.url}`)
      } else setMessage('Draft saved. It is still private until you publish it.')
      await reload()
    } catch (problem) { setError((problem as Error).message || 'Could not save the public profile.') }
    finally { setBusy(false) }
  }

  async function unpublish() {
    if (busy || !window.confirm('Unpublish the public profile sections? The trading card share can remain available.')) return
    setBusy(true); setError(''); setMessage('')
    try { await api(`/character-profiles/${id}/unpublish`, 'POST'); await reload(); setMessage('Public profile sections are unpublished.') }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function saveSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const source = await api<QuizSource & { reused?: boolean }>('/character-profiles/sources', 'POST', { title: sourceForm.title, sourceUrl: sourceForm.sourceUrl, category: sourceForm.category, description: sourceForm.description, tags: lines(sourceForm.tagsText) })
      await reload(); setSourceForm({ title: '', sourceUrl: '', category: '', description: '', tagsText: '' }); setResultForm(current => ({ ...current, quizSourceId: source.id }))
      setMessage(source.reused ? 'That quiz source was already saved; selected it for this result.' : 'Quiz source saved.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  async function saveResult(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const payload = { quizSourceId: resultForm.quizSourceId || null, resultTitle: resultForm.resultTitle, resultText: resultForm.resultText, notes: resultForm.notes, completedAt: new Date(`${resultForm.completedAt}T12:00:00.000Z`).toISOString(), visibility: resultForm.visibility }
    try {
      await api(`/character-profiles/${id}/quizzes${resultForm.id ? `/${resultForm.id}` : ''}`, resultForm.id ? 'PUT' : 'POST', payload)
      await reload(); setResultForm({ id: '', quizSourceId: '', resultTitle: '', resultText: '', notes: '', completedAt: dateInput(), visibility: 'private' }); setMessage('Quiz result saved.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  if (error && !data) return <section><h1 className="page-heading">Public character profile</h1><p role="alert">{error}</p><a href={`#character/${id}`}>Back to character</a></section>
  if (!data) return <section aria-busy="true"><p role="status">Loading profile studio.</p></section>

  const listField = (label: string, value: string[], change: (value: string[]) => void, help: string) => <label className="sprint-field">{label}<textarea rows={4} value={lineText(value)} onChange={event => change(lines(event.target.value))} placeholder={help} /><span className="field-help">One entry per line.</span></label>
  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => void) => <label className="profile-module-toggle"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /> {label}</label>
  function moveSection(key: ProfileSection, direction: -1 | 1) {
    const order = [...profile.sectionOrder], from = order.indexOf(key), to = from + direction
    if (to < 0 || to >= order.length) return
    ;[order[from], order[to]] = [order[to], order[from]]
    setProfile(current => ({ ...current, sectionOrder: order }))
  }

  return <section className="character-profile-studio" aria-labelledby="profile-studio-title">
    <a className="text-action" href={`#character/${id}`}>Back to {data.character.name}</a>
    <h1 id="profile-studio-title" className="page-heading">Public profile studio</h1>
    <p className="page-description">Build {title}&rsquo;s page one optional section at a time. Your trading card stays a separate feature and remains the featured visual on the shared page.</p>
    {error && <p role="alert" className="profile-error">{error}</p>}{message && <p role="status" className="success-pulse">{message}</p>}
    <div className="actions profile-studio-actions"><button type="button" className="secondary-button" onClick={() => { window.location.hash = `character/${id}` }}>Edit trading card</button><button type="button" disabled={busy} onClick={() => void saveDraft(false)}>{busy ? 'Saving.' : 'Save private draft'}</button><button type="button" disabled={busy} onClick={() => void saveDraft(true)}>{busy ? 'Publishing.' : data.share?.publishedAt ? 'Save & publish updates' : 'Publish profile'}</button>{data.share?.publishedAt && <button type="button" className="secondary-button" disabled={busy} onClick={() => void unpublish()}>Unpublish sections</button>}</div>
    {data.share?.url && <p className="field-help">Public page: <a href={data.share.url} target="_blank" rel="noopener noreferrer">{data.share.url}</a>{data.share.publishedAt ? ' · Published' : ' · Card share exists; profile sections are still private'}</p>}
    <div className="profile-studio-grid">
      <div className="profile-studio-sections">
        <details className="tracking-card"><summary>Arrange public sections</summary><p className="field-help">Choose the order visitors see. Hidden or empty sections stay out of the public page.</p><ol className="profile-section-order">{profile.sectionOrder.map((key, index) => <li key={key}><span>{PROFILE_SECTION_LABELS[key]}</span><div><button type="button" className="secondary-button" aria-label={`Move ${PROFILE_SECTION_LABELS[key]} up`} disabled={index === 0} onClick={() => moveSection(key, -1)}>Move up</button><button type="button" className="secondary-button" aria-label={`Move ${PROFILE_SECTION_LABELS[key]} down`} disabled={index === profile.sectionOrder.length - 1} onClick={() => moveSection(key, 1)}>Move down</button></div></li>)}</ol></details>
        <details className="tracking-card" open><summary>Introduction</summary>{checkbox('Show introduction', profile.introduction.enabled, enabled => setModule('introduction', { ...profile.introduction, enabled }))}<label className="sprint-field">Short introduction<textarea rows={4} maxLength={800} value={profile.introduction.text} onChange={event => setModule('introduction', { ...profile.introduction, text: event.target.value })} /></label></details>
        <details className="tracking-card"><summary>Biography</summary>{checkbox('Show biography', profile.biography.enabled, enabled => setModule('biography', { ...profile.biography, enabled }))}<label className="sprint-field">Biography<textarea rows={8} maxLength={6000} value={profile.biography.text} onChange={event => setModule('biography', { ...profile.biography, text: event.target.value })} /></label></details>
        <details className="tracking-card"><summary>Character details</summary>{checkbox('Show details', profile.basics.enabled, enabled => setModule('basics', { ...profile.basics, enabled }))}<div className="sprint-form">{(['pronouns','age','birthday','occupation','location'] as const).map(field => <label className="sprint-field" key={field}>{field[0].toUpperCase()+field.slice(1)}<input maxLength={100} value={profile.basics[field]} onChange={event => setModule('basics', { ...profile.basics, [field]: event.target.value })} /></label>)}</div><p className="field-help">These are profile-specific fields; private character notes are never copied here.</p></details>
        <details className="tracking-card"><summary>Personality & traits</summary>{checkbox('Show personality', profile.personality.enabled, enabled => setModule('personality', { ...profile.personality, enabled }))}<label className="sprint-field">Personality summary<textarea rows={5} maxLength={3000} value={profile.personality.summary} onChange={event => setModule('personality', { ...profile.personality, summary: event.target.value })} /></label>{listField('Traits', profile.personality.traits, traits => setModule('personality', { ...profile.personality, traits }), 'Warm, impulsive, stubborn')}</details>
        <details className="tracking-card"><summary>Relationships</summary>{checkbox('Show relationships', profile.relationships.enabled, enabled => setModule('relationships', { ...profile.relationships, enabled }))}{listField('Relationship notes', profile.relationships.entries, entries => setModule('relationships', { ...profile.relationships, entries }), 'Name — relationship — a short note')}</details>
        <details className="tracking-card"><summary>Quotes</summary>{checkbox('Show quotes', profile.quotes.enabled, enabled => setModule('quotes', { ...profile.quotes, enabled }))}{listField('Quotes', profile.quotes.entries, entries => setModule('quotes', { ...profile.quotes, entries }), 'One quote per line')}</details>
        <details className="tracking-card"><summary>Theme songs</summary>{checkbox('Show theme songs', profile.songs.enabled, enabled => setModule('songs', { ...profile.songs, enabled }))}{listField('Songs', profile.songs.entries, entries => setModule('songs', { ...profile.songs, entries }), 'Song — artist — optional link')}</details>
        <details className="tracking-card"><summary>Trivia & headcanons</summary>{checkbox('Show trivia', profile.trivia.enabled, enabled => setModule('trivia', { ...profile.trivia, enabled }))}{listField('Entries', profile.trivia.entries, entries => setModule('trivia', { ...profile.trivia, entries }), 'One fact or headcanon per line')}</details>
        <details className="tracking-card"><summary>Fictional social profile</summary>{checkbox('Show fictional profile', profile.social.enabled, enabled => setModule('social', { ...profile.social, enabled }))}<p className="field-help">A made-up character prop, not a connection to a real platform. It reuses the character's saved portrait as an avatar; posts are text and captions only. No platform logos or account sign-in.</p><div className="sprint-form"><label className="sprint-field">Profile format<select value={profile.social.format} onChange={event => setModule('social', { ...profile.social, format: event.target.value as CharacterProfile['social']['format'] })}><option value="short-posts">Short posts</option><option value="photo-journal">Photo journal</option><option value="media-shelf">Media shelf</option></select></label><label className="sprint-field">Display name<input maxLength={80} value={profile.social.displayName} onChange={event => setModule('social', { ...profile.social, displayName: event.target.value })} /></label><label className="sprint-field">Username<input maxLength={40} value={profile.social.username} onChange={event => setModule('social', { ...profile.social, username: event.target.value })} /></label><label className="sprint-field">Accent color<input type="color" value={profile.social.accentColor} onChange={event => setModule('social', { ...profile.social, accentColor: event.target.value })} /></label></div><label className="sprint-field">Bio<textarea rows={3} maxLength={500} value={profile.social.bio} onChange={event => setModule('social', { ...profile.social, bio: event.target.value })} /></label>{listField('Fictional posts / captions', profile.social.posts, posts => setModule('social', { ...profile.social, posts }), 'One fictional post or caption per line')}<div className="sprint-form"><label className="sprint-field">Followers (optional)<input type="number" min="0" max="999999999" value={profile.social.followers ?? ''} onChange={event => setModule('social', { ...profile.social, followers: event.target.value === '' ? null : Number(event.target.value) })} /></label><label className="sprint-field">Following (optional)<input type="number" min="0" max="999999999" value={profile.social.following ?? ''} onChange={event => setModule('social', { ...profile.social, following: event.target.value === '' ? null : Number(event.target.value) })} /></label></div></details>
        <details className="tracking-card"><summary>Quizzes & results</summary>{checkbox('Show public quiz results', profile.quizzes.enabled, enabled => setModule('quizzes', { enabled }))}<p className="field-help">Each result is private unless you explicitly set it public below. Quiz screenshots are not supported in this version.</p><form className="stack-form" onSubmit={event => void saveSource(event)}><h3>Save a reusable quiz link</h3><label>Quiz title<input required maxLength={120} value={sourceForm.title} onChange={event => setSourceForm({ ...sourceForm, title: event.target.value })} /></label><label>Source URL<input type="url" required maxLength={2048} value={sourceForm.sourceUrl} onChange={event => setSourceForm({ ...sourceForm, sourceUrl: event.target.value })} placeholder="https://" /></label><label>Category<input maxLength={80} value={sourceForm.category} onChange={event => setSourceForm({ ...sourceForm, category: event.target.value })} placeholder="Personality, alignment, aesthetic" /></label><label>Description<input maxLength={1000} value={sourceForm.description} onChange={event => setSourceForm({ ...sourceForm, description: event.target.value })} /></label><label>Tags (one per line)<textarea rows={2} maxLength={500} value={sourceForm.tagsText} onChange={event => setSourceForm({ ...sourceForm, tagsText: event.target.value })} placeholder="alignment, comfort, aesthetics" /></label><button type="submit" disabled={busy}>{busy ? 'Saving.' : 'Save quiz source'}</button></form>{data.quizSources.length > 0 && <ul className="profile-quiz-sources">{data.quizSources.map(source => <li key={source.id}><div><strong>{source.title}</strong><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a></div><button type="button" className="secondary-button" disabled={busy} onClick={async () => { if (!window.confirm(`Remove ${source.title} from the quiz library? Existing results will stay, without the source link.`)) return; try { setBusy(true); await api(`/character-profiles/sources/${source.id}`, 'DELETE'); await reload() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Remove source</button></li>)}</ul>}<form className="stack-form" onSubmit={event => void saveResult(event)}><h3>{resultForm.id ? 'Edit quiz result' : 'Add a character result'}</h3><label>Quiz source<select value={resultForm.quizSourceId} onChange={event => setResultForm({ ...resultForm, quizSourceId: event.target.value })}><option value="">No saved source</option>{data.quizSources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label><label>Result title<input required maxLength={160} value={resultForm.resultTitle} onChange={event => setResultForm({ ...resultForm, resultTitle: event.target.value })} placeholder="Your result" /></label><label>Result text<textarea rows={4} maxLength={5000} value={resultForm.resultText} onChange={event => setResultForm({ ...resultForm, resultText: event.target.value })} /></label><label>Private notes<textarea rows={3} maxLength={3000} value={resultForm.notes} onChange={event => setResultForm({ ...resultForm, notes: event.target.value })} /></label><label>Date completed<input type="date" required value={resultForm.completedAt} onChange={event => setResultForm({ ...resultForm, completedAt: event.target.value })} /></label><label>Visibility<select value={resultForm.visibility} onChange={event => setResultForm({ ...resultForm, visibility: event.target.value as 'private'|'public' })}><option value="private">Private</option><option value="public">Public profile</option></select></label><div className="actions"><button type="submit" disabled={busy}>{busy ? 'Saving.' : resultForm.id ? 'Update result' : 'Save result'}</button>{resultForm.id && <button type="button" className="secondary-button" onClick={() => setResultForm({ id: '', quizSourceId: '', resultTitle: '', resultText: '', notes: '', completedAt: dateInput(), visibility: 'private' })}>Cancel edit</button>}</div></form>{data.quizResults.length > 0 && <ul className="profile-quiz-sources">{data.quizResults.map(result => <li key={result.id}><div><strong>{result.resultTitle}</strong><span>{result.quizTitle ?? 'No source'} · {result.visibility} · {new Date(result.completedAt).toLocaleDateString()}</span></div><div className="actions"><button type="button" className="secondary-button" onClick={() => setResultForm({ id: result.id, quizSourceId: result.quizSourceId ?? '', resultTitle: result.resultTitle, resultText: result.resultText, notes: result.notes, completedAt: result.completedAt.slice(0, 10), visibility: result.visibility })}>Edit</button><button type="button" className="danger-button" disabled={busy} onClick={async () => { if (!window.confirm(`Delete the result “${result.resultTitle}”?`)) return; try { setBusy(true); await api(`/character-profiles/${id}/quizzes/${result.id}`, 'DELETE'); await reload() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Delete</button></div></li>)}</ul>}</details>
        <details className="tracking-card"><summary>Existing quicklinks</summary>{checkbox('Show my character quicklinks', profile.quicklinks.enabled, enabled => setModule('quicklinks', { enabled }))}<p className="field-help">Only links already saved for this character are shown. Private notes and drafts are never published.</p>{data.quicklinks.map(link => <p key={link.id}><strong>{link.label}</strong> · {link.url}</p>)}</details>
      </div>
      <aside className="profile-studio-preview" aria-label="Public profile preview"><section className="tracking-card"><p className="eyebrow">Preview · not published</p><h2><em>{title}</em></h2><p className="field-help">The trading card remains the featured visual. <a href={`#character/${id}`}>View card preview</a></p>{previewSections.length ? previewSections.map(([heading, body]) => <article key={heading}><h3>{heading}</h3><p>{body}</p></article>) : <p className="field-help">Enable and fill a section to see it here. Empty sections stay hidden.</p>}</section></aside>
    </div>
  </section>
}
