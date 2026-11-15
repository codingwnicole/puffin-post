export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'content-type':'application/json' },
    ...(body !== undefined ? { body:JSON.stringify(body) } : {}) })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to see your writing space.')
    const text = await response.text()
    let error: { error?: string; code?: string } | null = null
    try { error = JSON.parse(text) as { error?: string; code?: string } } catch { /* Some platform errors are plain text. */ }
    const thrown = new Error(error?.error ?? (text.trim() || `Request failed (${response.status})`))
    if (error?.code) (thrown as Error & { code?: string }).code = error.code
    throw thrown
  }
  // DELETE endpoints return 204; decoding an empty body made success look like failure.
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

// Stale-while-revalidate cache for page-load GETs only.
// Returns the cached value immediately (or undefined on a cold start) and refreshes
// in the background; on a refresh failure the old value stays and the error is
// returned to the caller. Mutations and post-mutation reloads keep using api()
// directly so they always hit the network for fresh data.
const getCache = new Map<string, unknown>()
export function staleGet<T>(path: string): Promise<T> {
  const cached = getCache.get(path) as T | undefined
  const refresh = api<T>(path)
    .then(value => { getCache.set(path, value); return value })
    .catch(error => {
      if (cached === undefined) throw error // cold start: nothing to fall back to
      return cached
    })
  if (cached === undefined) return refresh
  void refresh
  return Promise.resolve(cached)
}
// Sign-out and user switches must not leak one account's data into the next.
export function clearApiCache() { getCache.clear() }

export interface TrackingOptions { characters: { id:string; name:string }[]; partners: { id:string; name:string }[]; groups?:{id:string;name:string}[] }
