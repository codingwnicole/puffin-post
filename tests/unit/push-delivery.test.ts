import { afterEach, expect, it, vi } from 'vitest'
import { sendDuePushes, sendWorkspacePush } from '../../src/routes/push'
import type { Env } from '../../src/worker'

afterEach(() => vi.unstubAllGlobals())

it('backs off failed devices so the next batch reaches other writers, then retries after an hour', async () => {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), workspaceId: 'ws', endpoint: `https://fcm.googleapis.com/device/${i}`, last: null as string | null }))
  const db = { prepare(sql: string) { return { bind(...args: string[]) { return {
    async all() { return { results: rows.filter(row => !row.last || row.last < args[0]).slice(0, 9) } },
    async run() { const row = rows.find(row => row.id === args[1]); if (sql.startsWith('UPDATE') && row) row.last = args[0]; return {} },
  } } } } }
  const env = { DB: db, PUSH_VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', key.privateKey)) } as unknown as Env
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await sendDuePushes(env)
  expect(fetcher).toHaveBeenCalledTimes(9)
  expect(rows.slice(0, 9).every(row => row.last !== null)).toBe(true)
  expect(Date.now() - Date.parse(rows[0].last!)).toBeGreaterThanOrEqual(11 * 60 * 60_000 - 1000)
  await sendDuePushes(env)
  expect(fetcher).toHaveBeenCalledTimes(10)
  expect(fetcher.mock.calls[9][0]).toBe(rows[9].endpoint)
  rows[0].last = new Date(Date.now() - 12 * 60 * 60_000 - 1000).toISOString()
  await sendDuePushes(env)
  expect(fetcher.mock.calls[10][0]).toBe(rows[0].endpoint)
})

it('continues immediate notifications after one device throws', async () => {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const rows = [{id:'a',endpoint:'https://fcm.googleapis.com/a'}, {id:'b',endpoint:'https://fcm.googleapis.com/b'}]
  const env = { DB: { prepare: () => ({bind: () => ({all: async () => ({results:rows})})}) }, PUSH_VAPID_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', key.privateKey)) } as unknown as Env
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('', {status:201}))
  vi.stubGlobal('fetch', fetcher)
  await sendWorkspacePush(env, 'ws', {title:'Reply',body:'Your turn',url:'/'})
  expect(fetcher).toHaveBeenCalledTimes(2)
})
