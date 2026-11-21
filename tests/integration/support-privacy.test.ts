import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

// The support board is shared by every user, so no response may carry anyone's email.
let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture.dispose?.() })

it('support board never sends another user’s email', async () => {
  const db = fixture.env.DB
  await db.batch([
    db.prepare("INSERT INTO support_items (id,kind,title,description,status,submitted_by_user_id,created_at,updated_at) VALUES ('s1','bug','Broken','desc','reported','a','2026-01-01','2026-01-01')"),
    db.prepare("INSERT INTO support_comments (id,support_item_id,user_id,body,created_at) VALUES ('sc1','s1','a','We are on it','2026-01-02')"),
  ])
  const response = await fixture.request('/api/support', 'GET', undefined, 'b')
  expect(response.status).toBe(200)
  const text = await response.text()
  expect(text).toContain('We are on it')
  expect(text).not.toContain('@')
})

it('caps support reports and feature suggestion emails per user', async () => {
  const support = await Promise.all(Array.from({ length: 6 }, (_, index) => fixture.request('/api/support', 'POST', {
    kind: 'bug', title: `Report ${index}`, description: 'A sufficiently detailed report for the board.',
  }, 'a')))
  expect(support.slice(0, 5).every(response => response.status === 201)).toBe(true)
  expect(support[5].status).toBe(429)

  const suggestions = await Promise.all(Array.from({ length: 6 }, () => fixture.request('/api/feature-suggestions', 'POST', {
    message: 'A sufficiently detailed suggestion for the app.',
  }, 'a')))
  expect(suggestions.slice(0, 5).every(response => response.status === 201)).toBe(true)
  expect(suggestions[5].status).toBe(429)
})
