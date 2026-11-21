import { describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../../src/worker'

describe('domain migration routing', () => {
  it('301 redirects legacy requests while preserving paths and query parameters', async () => {
    const response = await worker.fetch(
      new Request('https://puffinpost.app/api/auth/verify?token=abc123&next=%2Finbox') as Parameters<typeof worker.fetch>[0],
      { APP_ORIGIN: 'https://rpthreadbuddy.app' } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://rpthreadbuddy.app/api/auth/verify?token=abc123&next=%2Finbox')
  })

  it('serves canonical-domain static assets through the configured binding', async () => {
    const assetResponse = new Response('app shell')
    const fetchAsset = vi.fn(async () => assetResponse)
    const env = { ASSETS: { fetch: fetchAsset } } as unknown as Env
    const response = await worker.fetch(new Request('https://rpthreadbuddy.app/') as Parameters<typeof worker.fetch>[0], env, {} as ExecutionContext)

    expect(response).toBe(assetResponse)
    expect(fetchAsset).toHaveBeenCalledOnce()
  })
})
