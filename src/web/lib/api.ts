export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'content-type':'application/json' },
    ...(body !== undefined ? { body:JSON.stringify(body) } : {}) })
  if (!response.ok) {
    if (response.status === 401) throw new Error("You've been signed out. Your text is kept; sign in again.")
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
// its current content and shows the error instead of blanking. Cache keys include
// the query string: a ?limit=/?cursor= page must never serve another page's rows.
const getCache = new Map<string, unknown>()
export function peekCache<T>(path: string, params?: URLSearchParams): T | undefined {
  const key = params && params.size ? `${path}?${params}` : path
  return getCache.get(key) as T | undefined
}
export async function staleGet<T>(path: string): Promise<T> {
  const value = await api<T>(path)
  getCache.set(path, value)
  return value
}
// Sign-out and user switches must not leak one account's data into the next.
export function clearApiCache() { getCache.clear(); for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith('puffin-draft:')) sessionStorage.removeItem(k) } }

// ---- item 7a: unsent-text safety net -------------------------------------
// Long text fields (draft editor, premise, planner notes) mirror their value
// into sessionStorage on every change and restore it after a failed save or a
// reload. Clear on successful save so the server copy wins.
const DRAFT_PREFIX = 'puffin-draft:'
export function saveDraftLocal(key: string, text: string) { try { sessionStorage.setItem(DRAFT_PREFIX + key, text) } catch { /* quota or private mode: text stays in the field either way */ } }
export function restoreDraftLocal(key: string): string | null { try { return sessionStorage.getItem(DRAFT_PREFIX + key) } catch { return null } }
export function clearDraftLocal(key: string) { try { sessionStorage.removeItem(DRAFT_PREFIX + key) } catch { /* ignore */ } }

// Safe prefetch: warm the destination's main D1-backed GET on hover/focus so the
// page seeds from cache. Only list-style, never-Tumblr GETs are eligible — starter
// detail and Tumblr activity touch the Tumblr client, and refresh routes are off-limits.
const PREFETCHABLE: Record<string, string> = { characters: '/characters', connections: '/connections', planner: '/character-planner', 'parking-lot': '/reply-drafts', tools: '/starters/options', settings: '/settings', support: '/support', inbox: '/inbox' }
const prefetchedAt = new Map<string, number>()
export function prefetch(path: string) {
  const key = path, now = Date.now()
  if (now - (prefetchedAt.get(key) ?? 0) < 30_000) return
  prefetchedAt.set(key, now)
  staleGet(path).catch(() => undefined) // best-effort; pages load their own copy
}
export function prefetchNav(page: string) { const target = PREFETCHABLE[page]; if (target) prefetch(target) }

export interface TrackingOptions { characters: { id:string; name:string }[]; partners: { id:string; name:string }[]; groups?:{id:string;name:string}[] }
