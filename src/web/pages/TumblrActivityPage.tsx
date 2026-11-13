import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Activity = { id: string; blogIdentifier: string; actor: string; timestamp: string; postId: string | null; preview: string | null; sourceUrl: string | null; threadKey?: string | null }
type Character = { id: string; name: string }

function blogLabel(value: string) { return value.replace(/\.tumblr\.com$/i, '') }

function postUrl(item: Activity) {
  if (item.sourceUrl) return item.sourceUrl
  if (!item.postId || item.actor === 'anonymous') return null
  return 'https://www.tumblr.com/' + item.actor.replace(/\.tumblr\.com$/i, '') + '/' + item.postId
}

export default function TumblrActivityPage() {
  const [asks, setAsks] = useState<Activity[]>([])
  const [mentions, setMentions] = useState<Activity[]>([])
  const [threadCandidates, setThreadCandidates] = useState<Activity[]>([])
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedCharacters, setSelectedCharacters] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([api<{ asks: Activity[]; mentions: Activity[]; threadCandidates: Activity[]; diagnostics: string[] }>('/tumblr-activity'), api<Character[]>('/characters')])
      .then(([activity, cast]) => { setAsks(activity.asks); setMentions(activity.mentions); setThreadCandidates(activity.threadCandidates); setDiagnostics(activity.diagnostics); setCharacters(cast); return api('/tumblr-activity/mark-seen','POST') })
      .catch(problem => setError(problem.message))
  }, [])

  async function addMention(item: Activity) {
    const characterId = selectedCharacters[item.id], url = postUrl(item)
    if (!characterId) { setError('Choose the character this starter is for first'); return }
    if (!url) { setError('Tumblr did not provide a usable post link for this tag'); return }
    setBusy(item.id); setError(''); setMessage('')
    try {
      await api('/starters', 'POST', { characterId, postUrl: url, partnerBlogIdentifier: item.id.startsWith('post:') || item.actor === 'anonymous' ? null : item.actor })
      const isSameThread = (other: Activity) => item.threadKey ? other.threadKey === item.threadKey : other.id === item.id
      setMentions(current => current.filter(mention => !isSameThread(mention)))
      setThreadCandidates(current => current.filter(candidate => !isSameThread(candidate)))
      setMessage('Starter added to your tracker.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy('') }
  }

  async function dismissCandidate(item: Activity) {
    if (!item.postId) return
    setBusy(item.id); setError(''); setMessage('')
    try {
      await api('/tumblr-activity/dismissals', 'POST', { blogIdentifier: item.blogIdentifier, postId: item.postId })
      setThreadCandidates(current => current.filter(candidate => candidate.id !== item.id))
      setMessage('Post dismissed from this review list.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy('') }
  }

  return <section aria-labelledby="activity-title">
    <h2 className="page-heading" id="activity-title">Tumblr activity</h2>
    <p className="page-description">New asks and tagged starters from the blogs assigned to your characters, in one small review queue.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {diagnostics.length > 0 && <p role="alert" className="refresh-warning">Could not check {diagnostics.join('; ')}</p>}
    <section className="tracking-card">
      <h3>Did you mean to track these?</h3>
      <p className="field-help">Recent posts from your connected blogs that are not in Puffin Post yet. Save the ones that are actually scenes; ignore the rest.</p>
      {threadCandidates.length ? threadCandidates.map(item => <article className="activity-row activity-mention" key={item.id}><div><strong>{blogLabel(item.blogIdentifier)}</strong><p>Recent post from your blog</p>{item.preview && <p className="activity-preview">{item.preview}</p>}{postUrl(item) && <p><a href={postUrl(item) ?? ''} target="_blank" rel="noopener noreferrer">Open Tumblr post</a></p>}</div><div className="activity-actions"><label>Track for<select value={selectedCharacters[item.id] ?? ''} onChange={event => setSelectedCharacters(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose a character</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><button disabled={busy === item.id || !postUrl(item)} onClick={() => void addMention(item)}>{busy === item.id ? 'Adding...' : 'Add to tracker'}</button><button className="secondary-button" disabled={busy === item.id} onClick={() => void dismissCandidate(item)}>{busy === item.id ? 'Saving...' : 'Dismiss this'}</button></div></article>) : <p>No untracked recent posts found.</p>}
    </section>
    <section className="tracking-card">
      <h3>Tagged starters</h3>
      {mentions.length ? mentions.map(item => <article className="activity-row activity-mention" key={item.id}><div><strong>{item.actor === 'anonymous' ? 'Tumblr member' : blogLabel(item.actor)}</strong><p>tagged {blogLabel(item.blogIdentifier)} &middot; {new Date(item.timestamp).toLocaleString()}</p>{item.preview && <p className="activity-preview">{item.preview}</p>}{postUrl(item) && <p><a href={postUrl(item) ?? ''} target="_blank" rel="noopener noreferrer">Open Tumblr post</a></p>}</div><div className="activity-actions"><label>Track for<select value={selectedCharacters[item.id] ?? ''} onChange={event => setSelectedCharacters(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose a character</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><button disabled={busy === item.id || !postUrl(item)} onClick={() => void addMention(item)}>{busy === item.id ? 'Adding...' : 'Add to tracker'}</button></div></article>) : <p>No new tagged posts found for your connected blogs.</p>}
    </section>
    <section className="tracking-card">
      <h3>Asks</h3>
      {asks.length ? asks.map(ask => <article className="activity-row" key={ask.blogIdentifier + ':' + ask.id}><div><strong>{ask.actor === 'anonymous' ? 'Anonymous ask' : blogLabel(ask.actor)}</strong><p>to {blogLabel(ask.blogIdentifier)} &middot; {new Date(ask.timestamp).toLocaleString()}</p></div><button onClick={async () => { try { await api('/reply-drafts', 'POST', { title: 'Answer ask from ' + (ask.actor === 'anonymous' ? 'anonymous' : blogLabel(ask.actor)), purpose: 'note', notes: 'Tumblr ask received on ' + blogLabel(ask.blogIdentifier) + '.', sourceUrl: 'https://www.tumblr.com/inbox', reminderAt: new Date(Date.now() + 86400000).toISOString() }); window.location.hash = 'parking-lot' } catch (problem) { setError((problem as Error).message) } }}>Remind me tomorrow</button></article>) : <p>No new asks found for the connected character blogs.</p>}
    </section>
  </section>
}
