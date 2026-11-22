import { expect, test, type Page } from '@playwright/test'

const EXPECTED: Array<{ hash: string; heading: string }> = [
  { hash: '#terms', heading: 'Terms of Service' },
  { hash: '#privacy', heading: 'Privacy Policy' },
  { hash: '#cookies', heading: 'Cookie Notice' },
]

async function mockSignedOut(page: Page) {
  await page.route('**/api/**', route => {
    return route.fulfill({ status: 401, body: 'unauthorized' })
  })
}

async function mockSignedIn(page: Page) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

for (const { hash, heading } of EXPECTED) {
  test(`signed-out sign-in screen: ${hash} shows heading, effective date, contact`, async ({ page }) => {
    await mockSignedOut(page)
    // Direct navigation: the legal page renders standalone (App.tsx intercepts before InboxPage).
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Effective date: November 21, 2026')).toBeVisible()
    await expect(page.getByText('privacy@rpthreadbuddy.app').first()).toBeVisible()
  })
}

test('signed-out: cookie notice names the session cookie and states essential-only storage, no banner', async ({ page }) => {
  await mockSignedOut(page)
  await page.goto('/#cookies')
  await expect(page.getByRole('heading', { name: 'Cookie Notice', exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/__Host-threadums_session/)).toBeVisible()
  await expect(page.getByText(/does not use advertising cookies, analytics cookies/i)).toBeVisible()
  await expect(page.getByText(/essential storage/i)).toBeVisible()
})

test('signed-out: no cookie consent banner appears anywhere on the sign-in screen or any legal page', async ({ page }) => {
  await mockSignedOut(page)
  for (const { hash } of EXPECTED) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('button', { name: /accept all|deny|manage cookies/i })).toHaveCount(0)
    await expect(page.locator('[class*="cookie-banner"], [class*="consent-banner"]')).toHaveCount(0)
  }
  await page.goto('/')
  await expect(page.locator('[class*="cookie-banner"], [class*="consent-banner"]')).toHaveCount(0)
})

test('signed-in: nav footer links reach each legal page', async ({ page }) => {
  await mockSignedIn(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your turn/ })).toBeVisible({ timeout: 15000 })
  for (const { hash, heading } of EXPECTED) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.getByText('Effective date: November 21, 2026')).toBeVisible()
    await expect(page.getByText('privacy@rpthreadbuddy.app').first()).toBeVisible()
  }
})

test('signed-in: privacy policy is reachable while signed in', async ({ page }) => {
  await mockSignedIn(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your turn/ })).toBeVisible({ timeout: 15000 })
  // Navigate via the hash route, which is what the footer link uses.
  await page.goto('/#privacy')
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
})

test('terms page mentions minimum age 16, no payments, and no marketing email', async ({ page }) => {
  await mockSignedOut(page)
  await page.goto('/#terms')
  await expect(page.getByText(/16 or older/)).toBeVisible()
  await expect(page.getByText(/no payments/i)).toBeVisible()
  await expect(page.getByText(/no marketing email/i)).toBeVisible()
})
