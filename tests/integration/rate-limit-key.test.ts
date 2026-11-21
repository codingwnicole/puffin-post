import { expect, it } from 'vitest'
import { opaqueRateLimitKey } from '../../src/auth/rate-limits'

it('keeps rate-limit identifiers stable for a secret without storing the original value', async () => {
  const value = 'password:email:alice@example.com'
  const key = await opaqueRateLimitKey('test-secret-that-is-long-enough-for-hmac', value)
  expect(key).toMatch(/^[a-f0-9]{64}$/)
  expect(key).toBe(await opaqueRateLimitKey('test-secret-that-is-long-enough-for-hmac', value))
  expect(key).not.toContain(value)
  expect(key).not.toBe(await opaqueRateLimitKey('different-secret-that-is-long-enough', value))
})
