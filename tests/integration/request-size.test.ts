import { expect, it } from 'vitest'
import { createApp, type Env } from '../../src/worker'

const appOrigin = 'https://rpthreadbuddy.test'
const env = { APP_ORIGIN: appOrigin, SESSION_SECRET: 'local-test-session-secret-at-least-32', TOKEN_ENCRYPTION_KEY: 'local-test-encryption-key-32-chars', ASSETS: { fetch: async () => new Response() } } as unknown as Env

it('rejects an oversized streamed API body even without Content-Length', async () => {
  const response = await createApp(env).request('/api/auth/magic-link', {
    method: 'POST', headers: { origin: appOrigin, 'content-type': 'application/json' }, body: new Uint8Array(5 * 1024 * 1024 + 1),
  }, env)
  expect(response.status).toBe(413)
})

it('rejects an oversized declared API body before parsing', async () => {
  const response = await createApp(env).request('/api/auth/magic-link', {
    method: 'POST', headers: { origin: appOrigin, 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024 + 1) }, body: '{}',
  }, env)
  expect(response.status).toBe(413)
})
