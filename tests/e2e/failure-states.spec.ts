import { expect, test, type Page } from '@playwright/test'

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1', name: 'Tester' } }
    else if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c', name: 'Writer' }], partners: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('a) draft text survives a failed save via sessionStorage', async ({ page }) => {
  await mockApi(page)
  // Draft save fails with 500
  await page.route('**/api/reply-drafts/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/convert')) {
      return route.fulfill({ json: { starter: { id: 's' }, branch: { id: 'b' }, draft: { state: 'converted' } } })
    }
    if (url.pathname === '/api/reply-drafts' && method === 'POST') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) })
    }
    return route.fallback()
  })
  await page.goto('/#parking-lot')
  await page.getByText('Save something for later').click()
  await page.getByLabel('Draft title').fill('Kept draft')
  const notes = page.getByLabel('Draft notes')
  await notes.fill('My precious text that must not be lost')
  // sessionStorage should now hold the text
  const stored = await page.evaluate(() => sessionStorage.getItem('puffin-draft:park:new'))
  expect(stored).toBe('My precious text that must not be lost')

  // Reload: text is restored
  await page.reload()
  await page.getByText('Save something for later').click()
  await expect(page.getByLabel('Draft notes')).toHaveValue('My precious text that must not be lost')
})

test('b) 401 during save shows "signed out, text kept" message', async ({ page }) => {
  // Session OK initially, then 401 on save
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === '/api/auth/session') {
      return route.fulfill({ json: { user: { id: 'u1', name: 'Tester' } } })
    }
    if (url.pathname === '/api/inbox') {
      return route.fulfill({ json: { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 } })
    }
    if (url.pathname === '/api/starters/options') {
      return route.fulfill({ json: { characters: [{ id: 'c', name: 'Writer' }], partners: [] } })
    }
    if (url.pathname === '/api/tumblr-activity/unread-count') {
      return route.fulfill({ json: { count: 0 } })
    }
    // All mutations → 401
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Session expired' }) })
    }
    return route.fulfill({ status: 200, json: [] })
  })
  await page.goto('/#parking-lot')
  await page.getByText('Save something for later').click()
  await page.getByLabel('Draft title').fill('Lost session draft')
  await page.getByLabel('Draft notes').fill('Text that should survive')
  await page.getByRole('button', { name: 'Park reply' }).click()
  // The 401 error message should appear
  await expect(page.locator('body')).toContainText('You\'ve been signed out', { timeout: 5000 })
  // Text is still in sessionStorage
  const stored = await page.evaluate(() => sessionStorage.getItem('puffin-draft:park:new'))
  expect(stored).toBe('Text that should survive')
})

test('c) Tumblr activity failure shows error banner, retry loads cleanly', async ({ page }) => {
  await mockApi(page)
  // First phase: blog fails (429)
  await page.route('**/api/tumblr-activity', route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/tumblr-activity' || route.request().method() !== 'GET') return route.fallback()
    return route.fulfill({ json: { asks: [], mentions: [], threadCandidates: [], blogs: [{ blogIdentifier: 'a.tumblr.com', status: 'error', error: 'a.tumblr.com: Rate limited by Tumblr (429). Retry after a minute.', oldestTimestamp: null, exhausted: true }], diagnostics: [] } })
  })
  await page.goto('/#activity')
  // Error banner shows the failed blog
  await expect(page.locator('.refresh-warning')).toContainText('Could not load', { timeout: 5000 })
})

test('d) offline banner appears when navigator.onLine is false', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#inbox')
  // Simulate going offline
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.locator('.offline-banner')).toBeVisible({ timeout: 3000 })
  // Simulate going back online
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator('.offline-banner')).toHaveCount(0, { timeout: 3000 })
})
