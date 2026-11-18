import { afterEach, describe, expect, it, vi } from 'vitest'
import { staleGet, peekCache, clearApiCache } from '../../src/web/lib/api'

// Minimal Response-like object that api() understands (.ok/.status/.json/.text).
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('stale-while-revalidate cache', () => {
  afterEach(() => { vi.unstubAllGlobals(); clearApiCache() })

  it('serves the last value via peekCache but staleGet always returns fresh data', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => { call += 1; return jsonResponse({ n: call }) }))
    expect(peekCache('/things')).toBeUndefined()
    expect((await staleGet<{ n: number }>('/things')).n).toBe(1)
    expect(peekCache<{ n: number }>('/things')?.n).toBe(1) // instant seed for the next visit
    expect((await staleGet<{ n: number }>('/things')).n).toBe(2) // post-mutation reloads are never stale
  })

  it('keeps the last good value when a refresh fails, and the failure surfaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ n: 1 })))
    await staleGet('/things')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })))
    await expect(staleGet('/things')).rejects.toThrow()
    expect(peekCache<{ n: number }>('/things')?.n).toBe(1)
  })

  it('clearApiCache drops cached data (sign-out / user switch)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ n: 1 })))
    await staleGet('/things')
    clearApiCache()
    expect(peekCache('/things')).toBeUndefined()
  })

  it('clearApiCache drops puffin-draft: sessionStorage keys and leaves others (sign-out / workspace switch)', () => {
    // Stub sessionStorage (node env has none). clearApiCache must remove only
    // draft keys so unrelated per-tab state survives a sign-out.
    const store = new Map<string, string>([['puffin-draft:branch-1', 'hello'], ['theme', 'dark']])
    const sessionStorage = {
      get length() { return store.size },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    }
    vi.stubGlobal('sessionStorage', sessionStorage)
    clearApiCache()
    expect(sessionStorage.getItem('puffin-draft:branch-1')).toBeNull()
    expect(sessionStorage.getItem('theme')).toBe('dark')
  })
})
