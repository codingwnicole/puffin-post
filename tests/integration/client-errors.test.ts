import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { createApp, type Env } from '../../src/worker'
import { redact } from '../../src/shared/redact'
import type { MockInstance } from 'vitest'

// Item 3b/3c: client-error reporting. The route must accept signed-out posts,
// redact emails/tokens before logging, cap the body, and rate-limit per IP.

let env: Env, dispose: () => Promise<void>, logSpy: MockInstance<typeof console.warn>
const IP = '203.0.113.7'

beforeEach(async () => {
  const platform = await getPlatformProxy<Env>({ persist: false })
  env = { ...platform.env, APP_ORIGIN: 'https://threadums.test' }
  dispose = platform.dispose
  for (const file of ['0001_initial.sql', '0002_auth.sql', '0029_rate_limits.sql']) {
    const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
    await env.DB.batch(sql.split(';').filter((part) => part.trim()).map((part) => env.DB.prepare(part)))
  }
  logSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(async () => { vi.restoreAllMocks(); await dispose() })

const post = async (path: string, body: string, ip: string = IP) =>
  createApp(env).request(path, {
    method: 'POST', headers: { origin: env.APP_ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body,
  }, env)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('redact()', () => {
  it('strips emails, bearer tokens and api keys', () => {
    expect(redact('sent to alice@example.com ok')).toBe('sent to [email] ok')
    expect(redact('token bearer sk-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ab')).toContain('[token]')
    expect(redact('Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789')).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789')
    expect(redact('no secrets here')).toBe('no secrets here')
  })
})

describe('POST /api/client-errors', () => {
  it('logs the redacted shape and answers 204 without a session', async () => {
    const response = await post('/api/client-errors', JSON.stringify({ message: 'boom at bob@corp.io key ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789' }))
    expect(response.status).toBe(204)
    // waitUntil runs after the response; let the microtask queue drain.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(logSpy).toHaveBeenCalledWith('client error', expect.objectContaining({
      message: expect.stringContaining('[email]'),
      route: '/api/client-errors',
      build: expect.any(String),
    }))
    const logged = logSpy.mock.calls.find(call => call[0] === 'client error')?.[1] as { message: string }
    expect(logged.message).not.toContain('bob@corp.io')
    expect(logged.message).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789')
  })

  it('rate-limits a chatty client (10 per 15 min per IP, then silent)', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post('/api/client-errors', JSON.stringify({ message: 'one' }))).status).toBe(204)
    }
    await sleep(100)
    // The 11th request is dropped: the limiter sees the same IP key.
    await post('/api/client-errors', JSON.stringify({ message: 'eleven' }))
    await sleep(100)
    const ipLogs = logSpy.mock.calls.filter(call => call[0] === 'client error').length
    expect(ipLogs).toBe(10)
    // A different IP is not affected.
    await post('/api/client-errors', JSON.stringify({ message: 'other-ip' }), '198.51.100.9')
    await sleep(100)
    expect(logSpy.mock.calls.filter(call => call[0] === 'client error').length).toBe(11)
  })

  it('keeps normal error text intact while capping the message at 300 chars', async () => {
    // 45 short words — realistic error text, no long token-like runs to redact.
    const words = Array.from({ length: 45 }, (_, i) => 'word' + i)
    const message = 'unhandledrejection: ' + words.join(' ')
    expect(message.length).toBeGreaterThan(300)
    expect((await post('/api/client-errors', JSON.stringify({ message }))).status).toBe(204)
    await sleep(100)
    const logged = logSpy.mock.calls.map(call => call[1]).find(entry => entry && typeof entry === 'object' && typeof (entry as { message?: string }).message === 'string' && (entry as { message: string }).message.length > 100) as { message: string }
    expect(logged).toBeDefined()
    expect(logged.message.length).toBe(300)
    expect(logged.message.startsWith('unhandledrejection: word0 word1')).toBe(true)
  })
})
