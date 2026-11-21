import { expect, test } from '@playwright/test'

test('shows the RP Thread Buddy app shell', async ({ page }) => {
  // AppShell renders the signed-in shell when GET /api/auth/session returns 200.
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
  await page.goto('/')
  await expect(page).toHaveTitle('RP Thread Buddy')
  await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Your turn')
})
