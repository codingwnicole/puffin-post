import { expect, it } from 'vitest'
import { hashPassword, verifyPassword, validPassword } from '../../src/auth/passwords'

// Cloudflare Workers caps PBKDF2 at 100,000 iterations. Locking the constant in
// a test so a future edit can't push the work past the platform limit and
// break password setup/sign-in at runtime (the production "210000" incident).
it('hashes passwords with a PBKDF2 round count at or under the 100k platform cap', async () => {
  const stored = await hashPassword('correct-horse')
  const [rounds] = stored.split('.')
  const count = Number(rounds)
  expect(Number.isSafeInteger(count)).toBe(true)
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(100_000)
})

it('round-trips a valid password and rejects the wrong one', async () => {
  const stored = await hashPassword('correct-horse')
  expect(await verifyPassword('correct-horse', stored)).toBe(true)
  expect(await verifyPassword('wrong-password', stored)).toBe(false)
})

it('rejects stored hashes whose iteration count exceeds the 100k cap', async () => {
  // A legacy/foreign hash recorded at 210,000 rounds must be refused rather
  // than handed to crypto.subtle, where the platform would throw.
  const forged = '210000.000102030405060708090a0b0c0d0e0f.00'.padEnd(91, '0')
  expect(await verifyPassword('correct-horse', forged)).toBe(false)
})

it('enforces the 8-200 character password length contract', () => {
  expect(validPassword('eight888')).toBe(true)
  expect(validPassword('short')).toBe(false)
  expect(validPassword('x'.repeat(201))).toBe(false)
  expect(validPassword(1234)).toBe(false)
})
