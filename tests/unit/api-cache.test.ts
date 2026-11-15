import { afterEach, describe, expect, it, vi } from 'vitest'
import { staleGet, clearApiCache } from '../../src/web/lib/api'

// Minimal Response-like object that api() understands (.ok/.status/.json/.text).
function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('stale-while-revalidate cache', () => {
  afterEach(() => { vi.restoreAllMocks(); clearApiCache() })

  it('returns cached data immediately and refreshes in the background on the second call', async () => {
    let call = 0
    // The first fetch hangs so we can observe that the second call resolves from the cache
    // while a background refetch is still in flight.
    const hanging = vi.fn(async () => { call += 1; await new Promise(resolve => setTimeout(resolve, 50)); return jsonResponse({ n: call }) })
    vi.stubGlobal('fetch', hanging)

    const first = await staleGet<{ n: number }>('/things')
    expect(first.n).toBe(1)

    // Second call: returns the cached payload (n:1) without waiting on the refetch.
    const second = await staleGet<{ n: number }>('/things')
    expect(second.n).toBe(1)
    // A background refetch was kicked off (a second fetch fired) even though we got cached data.
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledTimes(2))
  })

  it('clears the cache so the next call refetches instead of serving stale data', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => { call += 1; return jsonResponse({ n: call }) }))
    expect((await staleGet<{ n: number }>('/things')).n).toBe(1)

    clearApiCache()
    expect((await staleGet<{ n: number }>('/things')).n).toBe(2)
  })
})
