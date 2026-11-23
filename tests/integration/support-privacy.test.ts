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

it('sends support reports and feature suggestions to the support inbox, not the submitter', async () => {
  const fixtureFetch = globalThis.fetch, sent: Array<{ to: string[]; reply_to: string[] }> = []
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('api.resend.com')) { sent.push(JSON.parse(String(init?.body))); return new Response('{}') }
    return fixtureFetch(input, init)
  }
  try {
    expect((await fixture.request('/api/support', 'POST', { kind: 'feature', title: 'Dark mode', description: 'A sufficiently detailed idea.' }, 'a')).status).toBe(201)
    expect((await fixture.request('/api/feature-suggestions', 'POST', { message: 'A sufficiently detailed suggestion.' }, 'a')).status).toBe(201)
  } finally { globalThis.fetch = fixtureFetch }
  expect(sent.map(mail => mail.to)).toEqual([['support@rpthreadbuddy.app'], ['support@rpthreadbuddy.app']])
  // Replying to a report answers the person who sent it.
  expect(sent.every(mail => mail.reply_to.length === 1 && mail.reply_to[0].includes('@') && mail.reply_to[0] !== 'support@rpthreadbuddy.app')).toBe(true)
})
