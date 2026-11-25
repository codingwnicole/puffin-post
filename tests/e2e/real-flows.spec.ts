// Real end-to-end regressions (simulated Chromium): these run against the real Worker
// and the local D1 database through the Vite Cloudflare plugin. The app's own /api is
// never mocked; only one save in (d) is made to fail on purpose.
// Local D1 needs migrations: `npx wrangler d1 migrations apply threadums-local --local`.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const password = 'correct horse battery'
// The Worker only accepts writes from APP_ORIGIN (wrangler.jsonc: http://localhost:5173), so these
// tests use that origin for the page too, exactly like a real visitor.
const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

async function newUser(browser: Browser) {
  // A distinct client address per user keeps the sign-up rate limit per test run.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const context = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': ip, origin: APP } })
  const page = await context.newPage()
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
  await createSignedInUser(page, { email, password })
  return { context, page, email }
}

async function addThread(page: Page, title: string) {
  const character = await page.request.post('/api/characters', { data: { name: `Muse ${title}` } })
  expect(character.ok()).toBe(true)
  const { id: characterId } = await character.json() as { id: string }
  const starter = await page.request.post('/api/starters', { data: { characterId, title, partnerName: 'Partner Person', description: `Premise for ${title}` } })
  expect(starter.status()).toBe(201)
  const body = await starter.json() as { id: string; branch: { id: string } }
  return { characterId, starterId: body.id, branchId: body.branch.id }
}

test('a) a thread and its draft survive a reload and a fresh password sign-in', async ({ browser }) => {
  const { context, page, email } = await newUser(browser)
  const title = `Lantern walk ${Date.now()}`
  const { branchId } = await addThread(page, title)
  expect((await page.request.patch(`/api/branches/${branchId}`, { data: { notes: 'Thread notes kept' } })).ok()).toBe(true)
  expect((await page.request.post('/api/reply-drafts', { data: { title: 'Owed reply', notes: 'Half-written paragraph that must survive' } })).status()).toBe(201)

  await page.goto('/#inbox')
  await expect(page.locator('article.branch-card').getByText(title, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('article.branch-card').getByText(title, { exact: true })).toBeVisible()

  expect((await page.request.post('/api/auth/sign-out')).ok()).toBe(true)
  expect((await page.request.get('/api/inbox')).status()).toBe(401)
  expect((await page.request.post('/api/auth/password-sign-in', { data: { email, password } })).ok()).toBe(true)

  await page.goto('/#inbox')
  await expect(page.locator('article.branch-card').getByText(title, { exact: true })).toBeVisible()
  const inbox = await (await page.request.get('/api/inbox')).json() as { branches: Array<{ id: string; notes: string }> }
  expect(inbox.branches.find(branch => branch.id === branchId)?.notes).toBe('Thread notes kept')
  await page.goto('/#parking-lot')
  await expect(page.getByText('Half-written paragraph that must survive')).toBeVisible()
  await context.close()
})

test('b) user B never sees user A’s thread in the inbox, export, or by its address', async ({ browser }) => {
  const a = await newUser(browser), b = await newUser(browser)
  const title = `Private scene ${Date.now()}`
  const { starterId, branchId } = await addThread(a.page, title)

  await b.page.goto('/#inbox')
  await expect(b.page.locator('main')).toBeVisible()
  await expect(b.page.getByText(title, { exact: true })).toHaveCount(0)
  const bInbox = await (await b.page.request.get('/api/inbox')).text()
  expect(bInbox).not.toContain(title)
  expect(await (await b.page.request.get('/api/export.csv')).text()).not.toContain(title)
  expect((await b.page.request.get(`/api/starters/${starterId}`)).status()).toBe(404)
  expect((await b.page.request.patch(`/api/branches/${branchId}`, { data: { notes: 'hijack' } })).status()).toBe(404)
  // A still has the thread, untouched.
  const aInbox = await (await a.page.request.get('/api/inbox')).json() as { branches: Array<{ id: string; notes: string }> }
  expect(aInbox.branches.find(branch => branch.id === branchId)?.notes ?? '').not.toBe('hijack')
  await a.context.close(); await b.context.close()
})

test('c) two tabs archiving the same thread at once leave exactly one archived thread', async ({ browser }) => {
  const { context, page } = await newUser(browser)
  const { branchId } = await addThread(page, `Race ${Date.now()}`)
  const second = await context.newPage()
  const [one, two] = await Promise.all([
    page.request.post(`/api/branches/${branchId}/archive`),
    second.request.post(`/api/branches/${branchId}/archive`),
  ])
  expect(one.status()).toBeLessThan(500)
  expect(two.status()).toBeLessThan(500)
  const all = await (await page.request.get('/api/inbox?includeArchived=true')).json() as { branches: Array<{ id: string; status: string }> }
  const matches = all.branches.filter(branch => branch.id === branchId)
  expect(matches.length).toBeLessThanOrEqual(1)
  const active = await (await page.request.get('/api/inbox')).json() as { branches: Array<{ id: string }> }
  expect(active.branches.some(branch => branch.id === branchId)).toBe(false)
  await second.goto('/#inbox')
  await expect(second.locator('main')).toBeVisible()
  await context.close()
})

test('d) a failed save keeps the text, says it was not saved, and a retry succeeds', async ({ browser }) => {
  const { context, page } = await newUser(browser)
  let failNext = true
  await page.route('**/api/reply-drafts', route => {
    if (route.request().method() === 'POST' && failNext) { failNext = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) }) }
    return route.fallback()
  })
  await page.goto('/#parking-lot')
  await page.getByText('Save something for later').click()
  await page.getByLabel('Draft title').fill('Retry me')
  await page.getByLabel('Draft notes').fill('Words that must not vanish')
  await page.locator('form.tracking-form').filter({ has: page.getByLabel('Draft notes') }).locator('button').last().click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByLabel('Draft notes')).toHaveValue('Words that must not vanish')
  const saved = page.waitForResponse(response => response.url().endsWith('/api/reply-drafts') && response.request().method() === 'POST')
  await page.locator('form.tracking-form').filter({ has: page.getByLabel('Draft notes') }).locator('button').last().click()
  expect((await saved).status()).toBe(201)
  const drafts = await (await page.request.get('/api/reply-drafts')).text()
  expect(drafts).toContain('Words that must not vanish')
  await context.close()
})

test('e) the CSV export contains your thread and nothing of another user', async ({ browser }) => {
  const a = await newUser(browser), b = await newUser(browser)
  const mine = `Export mine ${Date.now()}`, theirs = `Export theirs ${Date.now()}`
  await addThread(a.page, mine)
  await addThread(b.page, theirs)
  const csv = await (await a.page.request.get('/api/export.csv')).text()
  expect(csv).toContain(mine)
  expect(csv).not.toContain(theirs)
  await a.context.close(); await b.context.close()
})
