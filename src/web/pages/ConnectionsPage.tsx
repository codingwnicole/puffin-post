import { useEffect, useState, type FormEvent } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Connection = { id:string; status:string; blogs:string[] }
export default function ConnectionsPage() {
  const [connections,setConnections] = useState<Connection[]>([]), [options,setOptions] = useState<TrackingOptions>({ characters:[],partners:[] }), [characterId,setCharacterId] = useState(''), [connectionId,setConnectionId] = useState(''), [blog,setBlog] = useState(''), [error,setError] = useState(''), [notice,setNotice] = useState('')
  useEffect(() => { Promise.all([api<Connection[]>('/connections'),api<TrackingOptions>('/starters/options')]).then(([connections,options]) => { setConnections(connections); setOptions(options); setConnectionId(connections[0]?.id ?? ''); setBlog(connections[0]?.blogs[0] ?? ''); setCharacterId(options.characters[0]?.id ?? '') }).catch(error => setError(error.message)) },[])
  const active = connections.find(connection => connection.id === connectionId)
  function chooseConnection(id:string) { setConnectionId(id); setBlog(connections.find(connection => connection.id === id)?.blogs[0] ?? '') }
  async function assign(event:FormEvent) { event.preventDefault(); setError(''); setNotice(''); try { await api(`/connections/${connectionId}/blogs`,'POST',{ characterId,blogIdentifier:blog,displayLabel:blog }); setNotice('Tumblr blog assigned to this character.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not assign Tumblr blog.') } }
  return <section aria-labelledby="page-title"><h2 id="page-title" className="page-heading">Tumblr connections</h2>
    <p className="page-description">Connect an account, then assign one of its returned blogs to a character before tracking starters.</p>
    <a className="button" href="/api/tumblr/connect">Connect Tumblr</a>
    {error && <p role="alert">{error}</p>}
    <ul>{connections.map(connection => <li key={connection.id}><strong>{connection.status}</strong>: {connection.blogs.join(', ') || 'No blogs available'}</li>)}</ul>
    {connections.length > 0 && options.characters.length > 0 && <form onSubmit={assign} className="stack-form">
      <label>Character<select value={characterId} onChange={event => setCharacterId(event.target.value)}>{options.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <label>Tumblr account<select value={connectionId} onChange={event => chooseConnection(event.target.value)}>{connections.map(connection => <option key={connection.id} value={connection.id}>Connected account</option>)}</select></label>
      <label>Available blog<select value={blog} onChange={event => setBlog(event.target.value)}>{active?.blogs.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="button" disabled={!characterId || !blog}>Assign blog</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
