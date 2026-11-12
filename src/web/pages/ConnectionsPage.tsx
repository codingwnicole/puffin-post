import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Connection = { id:string; status:string; blogs:string[] }
export default function ConnectionsPage() {
  const [connections,setConnections] = useState<Connection[]>([]), [error,setError] = useState('')
  useEffect(() => { api<Connection[]>('/connections').then(setConnections).catch(error => setError(error.message)) },[])
  return <section aria-labelledby="page-title"><h2 id="page-title" className="page-heading">Tumblr connections</h2>
    <p className="page-description">Connect an account, then assign one of its returned blogs to a character before tracking starters.</p>
    <a className="button" href="/api/tumblr/connect">Connect Tumblr</a>
    {error && <p role="alert">{error}</p>}
    <ul>{connections.map(connection => <li key={connection.id}><strong>{connection.status}</strong>: {connection.blogs.join(', ') || 'No blogs available'}</li>)}</ul>
  </section>
}
