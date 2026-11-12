import { useEffect, useState, type FormEvent } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Assignment = { id:string; characterId:string; characterName:string; blogIdentifier:string; displayLabel:string }
type Connection = { id:string; status:string; blogs:string[]; assignments:Assignment[] }
export default function ConnectionsPage() {
  const [connections,setConnections] = useState<Connection[]>([]), [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] }), [characterId,setCharacterId] = useState(''), [connectionId,setConnectionId] = useState(''), [blog,setBlog] = useState(''), [error,setError] = useState(''), [notice,setNotice] = useState('')
  useEffect(() => { Promise.all([api<Connection[]>('/connections'),api<TrackingOptions>('/starters/options')]).then(([connections,options]) => { setConnections(connections); setOptions(options); setConnectionId(connections[0]?.id ?? ''); setBlog(connections[0]?.blogs[0] ?? ''); setCharacterId(options.characters[0]?.id ?? '') }).catch(error => setError(error.message)) },[])
  const active = connections.find(connection => connection.id === connectionId)
  function chooseConnection(id:string) { setConnectionId(id); setBlog(connections.find(connection => connection.id === id)?.blogs[0] ?? '') }
  async function assign(event:FormEvent) { event.preventDefault(); setError(''); setNotice(''); try { await api(`/connections/${connectionId}/blogs`,'POST',{ characterId,blogIdentifier:blog,displayLabel:blog }); setNotice('Tumblr blog assigned to this character.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not assign Tumblr blog.') } }
  return <section aria-labelledby="page-title"><h2 id="page-title" className="page-heading">Tumblr connections</h2>
    <p className="page-description">Connect as many Tumblr accounts as you use. Every returned blog can be assigned separately, including multiple blogs to the same character.</p>
    <a className="button" href="/api/tumblr/connect">Connect a Tumblr account</a>
    {error && <p role="alert">{error}</p>}
    <div className="connection-list">{connections.map((connection,index) => <article className="tracking-card connection-card" key={connection.id}>
      <div><p className="eyebrow">Tumblr account {index + 1}</p><h3>{connection.status === 'active' ? 'Connected' : connection.status}</h3></div>
      {connection.blogs.length > 0 ? <ul className="blog-list" aria-label={`Blogs on Tumblr account ${index + 1}`}>{connection.blogs.map(blog => {
        const assignment = connection.assignments.find(item => item.blogIdentifier === blog)
        return <li key={blog}><code>{blog}</code>{assignment ? <span>Assigned to {assignment.characterName}</span> : <span>Available to assign</span>}</li>
      })}</ul> : <p>No blogs were returned by Tumblr. Try reconnecting the account.</p>}
    </article>)}</div>
    {connections.length > 0 && options.characters.length > 0 && <form onSubmit={assign} className="stack-form">
      <h3>Assign a blog to a character</h3><p className="field-help">Repeat this for every blog you want the character to track.</p>
      <label>Character<select value={characterId} onChange={event => setCharacterId(event.target.value)}>{options.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <label>Tumblr account<select value={connectionId} onChange={event => chooseConnection(event.target.value)}>{connections.map((connection,index) => <option key={connection.id} value={connection.id}>Tumblr account {index + 1}</option>)}</select></label>
      <label>Blog<select value={blog} onChange={event => setBlog(event.target.value)}>{active?.blogs.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="button" disabled={!characterId || !blog}>Assign this blog</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
