import { describe, it, expect } from 'vitest'
import { isAllowedTumblrHost } from '../../src/tumblr/ssrf-guard'
import { createTumblrClient } from '../../src/tumblr/client'

describe('SSRF guard: isAllowedTumblrHost', () => {
  it.each([
    ['tumblr.com', true],
    ['www.tumblr.com', true],
    ['api.tumblr.com', true],
    ['a.tumblr.com', true],
    ['my.blog.tumblr.com', true],
    ['127.0.0.1', false],
    ['localhost', false],
    ['evil.com', false],
    ['tumblr.com.evil.com', false],
    ['api.tumblr.com.evil.com', false],
    ['192.168.0.1', false],
    ['[::1]', false],
  ])('%s => %s', (host, expected) => {
    expect(isAllowedTumblrHost(host)).toBe(expected)
  })
})

describe('SSRF guard: client blocks disallowed hosts', () => {
  it('rejects any URL whose hostname is not a tumblr.com domain', async () => {
    // The client normally builds api.tumblr.com URLs, but a custom fetch or a
    // tampered URL could redirect elsewhere. safeRun must reject those before
    // the request leaves the process.
    let called = 0
    const fakeFetch: typeof fetch = (async () => {
      called++
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    // Force a disallowed hostname through the guard by patching URL.
    const RealURL = globalThis.URL
    class FakeURL extends (RealURL as unknown as new (s: string) => URL) {
      get hostname() { return 'evil.com' }
    }
    const originalURL = globalThis.URL
    ;(globalThis as unknown as { URL: typeof URL }).URL = FakeURL as unknown as typeof URL
    try {
      const client = createTumblrClient({ consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts', fetch: fakeFetch })
      await expect(client.getPost('a.tumblr.com', '123')).rejects.toThrow(/disallowed host/)
    } finally {
      ;(globalThis as unknown as { URL: typeof URL }).URL = originalURL
    }
    expect(called).toBe(0)
  })

  it('passes a timeout AbortSignal on every outbound request (S14)', async () => {
    const calls: Array<{ url: string; signal?: AbortSignal | null }> = []
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), signal: init?.signal })
      return new Response(JSON.stringify({ response: { id_string: '42', blog: { name: 'a' }, content: [{ text: 'hi' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const client = createTumblrClient({ consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts', fetch: fakeFetch })
    await client.getPost('a.tumblr.com', '12345')
    for (const call of calls) {
      expect(call.signal, `timeout signal missing for ${call.url}`).toBeInstanceOf(AbortSignal)
    }
    expect(calls.length).toBeGreaterThan(0)
  })

  it('allows legitimate api.tumblr.com URLs', async () => {
    const mockFetch = (async (input: RequestInfo | URL) => {
      return new Response(JSON.stringify({ response: { id_string: '42', blog: { name: 'a' }, content: [{ text: 'hi' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const client = createTumblrClient({
      consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts',
      fetch: mockFetch,
    })
    const post = await client.getPost('a.tumblr.com', '12345')
    expect(post.id).toBe('42')
  })
})
