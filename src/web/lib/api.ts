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

// Stale-while-revalidate for page-load GETs: pages seed their first render from
// peekCache(path) (instant, possibly stale), then staleGet(path) always hits the
// network and records the fresh value. A failed refresh throws, so the page keeps
// its current content and shows the error instead of blanking.
const getCache = new Map<string, unknown>()
export function peekCache<T>(path: string): T | undefined { return getCache.get(path) as T | undefined }
export async function staleGet<T>(path: string): Promise<T> {
  const value = await api<T>(path)
  getCache.set(path, value)
  return value
}
// Sign-out and user switches must not leak one account's data into the next.
export function clearApiCache() { getCache.clear() }

export interface TrackingOptions { characters: { id:string; name:string }[]; partners: { id:string; name:string }[]; groups?:{id:string;name:string}[] }
