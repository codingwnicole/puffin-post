export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'content-type':'application/json' },
    ...(body !== undefined ? { body:JSON.stringify(body) } : {}) })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to see your writing space.')
    const text = await response.text()
    let error: { error?: string } | null = null
    try { error = JSON.parse(text) as { error?: string } } catch { /* Some platform errors are plain text. */ }
    throw new Error(error?.error ?? (text.trim() || `Request failed (${response.status})`))
  }
  // DELETE endpoints return 204; decoding an empty body made success look like failure.
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
export interface TrackingOptions { characters: { id:string; name:string }[]; partners: { id:string; name:string }[]; groups?:{id:string;name:string}[] }
