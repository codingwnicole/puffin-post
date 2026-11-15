import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Activity = { id: string; blogIdentifier: string; actor: string; timestamp: string; postId: string | null; preview: string | null; sourceUrl: string | null; threadKey?: string | null }
type Character = { id: string; name: string }
type BlogState = { blogIdentifier: string; status: 'ok' | 'error'; error: string | null; oldestTimestamp: string | null; exhausted: boolean }
type ActivityResponse = { asks: Activity[]; mentions: Activity[]; threadCandidates: Activity[]; blogs: BlogState[]; diagnostics: string[] }

function blogLabel(value: string) { return value.replace(/\.tumblr\.com$/i, '') }

function postUrl(item: Activity) {
  if (item.sourceUrl) return item.sourceUrl
  if (!item.postId || item.actor === 'anonymous') return null
  return 'https://www.tumblr.com/' + item.actor.replace(/\.tumblr\.com$/i, '') + '/' + item.postId
}

function fetchActivity(blog?: string | null, before?: string | null) {
  const params = new URLSearchParams()
  if (blog) params.set('blog', blog)
  if (before) params.set('before', before)
  const query = params.toString()
  return api<ActivityResponse>(`/tumblr-activity${query ? `?${query}` : ''}`)
}

export default function TumblrActivityPage() {
  const [asks, setAsks] = useState<Activity[]>([])
  const [mentions, setMentions] = useState<Activity[]>([])
  const [threadCandidates, setThreadCandidates] = useState<Activity[]>([])
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [blogs, setBlogs] = useState<BlogState[]>([])
  const [blogFilter, setBlogFilter] = useState('')
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedCharacters, setSelectedCharacters] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})
  const [needsBlog, setNeedsBlog] = useState<Record<string, boolean>>({})
  const [hasMore, setHasMore] = useState(false)
  const [oldestShown, setOldestShown] = useState<string | null>(null)

  function applyResponse(response: ActivityResponse, replace: boolean) {
    setBlogs(response.blogs)
    setDiagnostics(response.diagnostics)
    if (replace) {
      setAsks(response.asks); setMentions(response.mentions); setThreadCandidates(response.threadCandidates)
    } else {
      setAsks(current => { const seen = new Set(current.map(item => item.id)); return [...current, ...response.asks.filter(item => !seen.has(item.id))] })
      setMentions(current => { const seen = new Set(current.map(item => item.id)); return [...current, ...response.mentions.filter(item => !seen.has(item.id))] })
      setThreadCandidates(current => { const seen = new Set(current.map(item => item.id)); return [...current, ...response.threadCandidates.filter(item => !seen.has(item.id))] })
    }
    const oldestTimestamps = response.blogs.filter(blog => blog.status === 'ok' && blog.oldestTimestamp !== null).map(blog => new Date(blog.oldestTimestamp as string).getTime())
    setOldestShown(oldestTimestamps.length > 0 ? new Date(Math.min(...oldestTimestamps)).toISOString() : null)
    // exhausted = Tumblr returned no (more) items for that blog. A blog with items may have
    // older pages, so leave Load older up; a load that comes back empty flips it off.
    setHasMore(response.blogs.some(blog => blog.status === 'ok' && !blog.exhausted))
  }

  useEffect(() => {
    let active = true
    setError(''); setMessage('')
    void fetchActivity(blogFilter || null)
      .then(response => { if (active) applyResponse(response, true) })
      .catch(problem => { if (active) setError(problem.message) })
    if (!blogFilter) api<Character[]>('/characters').then(setCharacters).catch(() => undefined)
    return () => { active = false }
  }, [blogFilter])

  useEffect(() => {
    if (blogs.length > 0) void api('/tumblr-activity/mark-seen', 'POST').catch(() => undefined)
  }, [blogs.length])

  function loadOlder() {
    if (!oldestShown) return
    setBusy('older'); setError(''); setMessage('')
    void fetchActivity(blogFilter || null, oldestShown)
      .then(response => {
        const count = response.asks.length + response.mentions.length + response.threadCandidates.length
        if (count === 0) { setHasMore(false); setMessage('That was the oldest activity.') }
        else { applyResponse(response, false); setHasMore(false) }
      })
      .catch(problem => setError(problem.message))
      .finally(() => setBusy(''))
  }

  async function addMention(item: Activity) {
    const characterId = selectedCharacters[item.id], url = postUrl(item)
    if (!characterId) { setError('Choose the character this starter is for first'); return }
    if (!url) { setItemErrors(current => ({ ...current, [item.id]: 'Tumblr did not provide a usable post link for this tag' })); return }
    setBusy(item.id); setError(''); setMessage(''); setItemErrors(current => { const next = { ...current }; delete next[item.id]; return next }); setNeedsBlog(current => { const next = { ...current }; delete next[item.id]; return next })
    try {
      await api('/starters', 'POST', { characterId, postUrl: url, partnerBlogIdentifier: item.id.startsWith('post:') || item.actor === 'anonymous' ? null : item.actor })
      // Remove the tracked item from local state instead of reloading the whole page.
      const isSameThread = (other: Activity) => item.threadKey ? other.threadKey === item.threadKey : other.id === item.id
      setMentions(current => current.filter(mention => !isSameThread(mention)))
      setThreadCandidates(current => current.filter(candidate => !isSameThread(candidate)))
      setMessage('Starter added to your tracker.')
    } catch (problem) {
      const fail = problem as Error & { code?: string }
      // A missing character blog is a setup gap the user can fix in-place; route it there.
      setItemErrors(current => ({ ...current, [item.id]: fail.code === 'character_needs_blog' ? 'Assign a Tumblr blog to this character before tracking a thread.' : fail.message }))
      setNeedsBlog(current => ({ ...current, [item.id]: fail.code === 'character_needs_blog' }))
    } finally { setBusy('') }
  }

  async function dismissCandidate(item: Activity) {
    if (!item.postId) return
    setBusy(item.id); setError(''); setMessage('')
    try {
      await api('/tumblr-activity/dismissals', 'POST', { blogIdentifier: item.blogIdentifier, postId: item.postId })
      // Remove only the dismissed candidate; no full reload.
      setThreadCandidates(current => current.filter(candidate => candidate.id !== item.id))
      setMentions(current => current.filter(mention => mention.id !== item.id))
      setMessage('Post dismissed from this review list.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy('') }
  }

  const failedBlogs = blogs.filter(blog => blog.status === 'error')
  // Never claim the queue is complete (or empty) while a blog failed to load.
  const incomplete = failedBlogs.length > 0

  return <section aria-labelledby="activity-title">
    <h2 className="page-heading" id="activity-title">Tumblr activity</h2>
    <p className="page-description">New asks and tagged starters from the blogs assigned to your characters, in one small review queue.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {failedBlogs.length > 0 && <p role="alert" className="refresh-warning">Could not load: {failedBlogs.map(blog => blogLabel(blog.blogIdentifier)).join(', ')}. Items from those blogs are missing from this list.</p>}
    {diagnostics.length > 0 && <p role="alert" className="refresh-warning">Could not check {diagnostics.join('; ')}</p>}
    <div className="activity-controls">
      <label>Blog<select value={blogFilter} onChange={event => setBlogFilter(event.target.value)}><option value="">All blogs</option>{blogs.map(blog => <option key={blog.blogIdentifier} value={blog.blogIdentifier}>{blogLabel(blog.blogIdentifier)}</option>)}</select></label>
      {hasMore && <button className="secondary-button" disabled={busy === 'older'} onClick={loadOlder}>{busy === 'older' ? 'Loading...' : 'Load older'}</button>}
    </div>
    <section className="tracking-card">
      <h3>Did you mean to track these?</h3>
      <p className="field-help">Recent posts from your connected blogs that are not in Puffin Post yet. Save the ones that are actually scenes; ignore the rest.</p>
      {threadCandidates.length ? threadCandidates.map(item => <article className="activity-row activity-mention" key={item.id}><div><strong>{blogLabel(item.blogIdentifier)}</strong><p>Recent post from your blog</p>{item.preview && <p className="activity-preview">{item.preview}</p>}{postUrl(item) && <p><a href={postUrl(item) ?? ''} target="_blank" rel="noopener noreferrer">Open Tumblr post</a></p>}</div><div className="activity-actions"><label>Track for<select value={selectedCharacters[item.id] ?? ''} onChange={event => setSelectedCharacters(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose a character</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><button disabled={busy === item.id || !postUrl(item)} onClick={() => void addMention(item)}>{busy === item.id ? 'Adding...' : 'Add to tracker'}</button><button className="secondary-button" disabled={busy === item.id} onClick={() => void dismissCandidate(item)}>{busy === item.id ? 'Saving...' : 'Dismiss this'}</button>{!postUrl(item) && <span className="field-help">No post link to track.</span>}{itemErrors[item.id] && <span role="alert">{itemErrors[item.id]}{needsBlog[item.id] && <> <a href="#connections">Assign a blog</a></>}</span>}</div></article>) : <p>{incomplete ? 'Posts from the failed blogs are missing.' : 'No untracked recent posts found.'}</p>}
    </section>
    <section className="tracking-card">
      <h3>Tagged starters</h3>
      {mentions.length ? mentions.map(item => <article className="activity-row activity-mention" key={item.id}><div><strong>{item.actor === 'anonymous' ? 'Tumblr member' : blogLabel(item.actor)}</strong><p>tagged {blogLabel(item.blogIdentifier)} &middot; {new Date(item.timestamp).toLocaleString()}</p>{item.preview && <p className="activity-preview">{item.preview}</p>}{postUrl(item) && <p><a href={postUrl(item) ?? ''} target="_blank" rel="noopener noreferrer">Open Tumblr post</a></p>}</div><div className="activity-actions"><label>Track for<select value={selectedCharacters[item.id] ?? ''} onChange={event => setSelectedCharacters(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose a character</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><button disabled={busy === item.id || !postUrl(item)} onClick={() => void addMention(item)}>{busy === item.id ? 'Adding...' : 'Add to tracker'}</button>{!postUrl(item) && <span className="field-help">No post link to track.</span>}{itemErrors[item.id] && <span role="alert">{itemErrors[item.id]}{needsBlog[item.id] && <> <a href="#connections">Assign a blog</a></>}</span>}</div></article>) : <p>{incomplete ? 'Tagged posts from the failed blogs are missing.' : 'No new tagged posts found for your connected blogs.'}</p>}
    </section>
    <section className="tracking-card">
      <h3>Asks</h3>
      {asks.length ? asks.map(ask => <article className="activity-row" key={ask.blogIdentifier + ':' + ask.id}><div><strong>{ask.actor === 'anonymous' ? 'Anonymous ask' : blogLabel(ask.actor)}</strong><p>to {blogLabel(ask.blogIdentifier)} &middot; {new Date(ask.timestamp).toLocaleString()}</p></div><button onClick={async () => { try { await api('/reply-drafts', 'POST', { title: 'Answer ask from ' + (ask.actor === 'anonymous' ? 'anonymous' : blogLabel(ask.actor)), purpose: 'note', notes: 'Tumblr ask received on ' + blogLabel(ask.blogIdentifier) + '.', sourceUrl: 'https://www.tumblr.com/inbox', reminderAt: new Date(Date.now() + 86400000).toISOString() }); window.location.hash = 'parking-lot' } catch (problem) { setError((problem as Error).message) } }}>Remind me tomorrow</button></article>) : <p>{incomplete ? 'Asks from the failed blogs are missing.' : 'No new asks found for the connected character blogs.'}</p>}
    </section>
  </section>
}
