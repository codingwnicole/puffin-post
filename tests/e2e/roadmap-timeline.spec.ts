import { expect, test, type Page } from '@playwright/test'

const items = ['Discord integration and bot', 'UI refresh', 'Dashboard and trading card skins', 'Buddy assistant'].map((title, index) => ({
  id: `rm${index}`, title, description: 'Target: early December. A short description of the plan.', status: index < 3 ? 'in_progress' : 'planned', icon: index === 3 ? null : ['chat', 'palette', 'cards'][index],
  sortOrder: index * 10, createdAt: '2026-11-23', updatedAt: '2026-11-23',
}))

async function openRoadmap(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: 'u1', name: 'Tester' } } })
    if (path === '/api/tumblr-activity/unread-count') return route.fulfill({ json: { count: 0 } })
    if (path === '/api/roadmap') return route.fulfill({ json: { items, canManage: false } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/#roadmap')
  await expect(page.locator('.roadmap-item')).toHaveCount(4)
  await expect(page.locator('.roadmap-item .roadmap-icon svg')).toHaveCount(4) // an item with no icon falls back to the sparkle
}

test('roadmap cards alternate around the timeline on wide screens and stack on phones', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openRoadmap(page)
  const left = (n: number) => page.locator('.roadmap-item').nth(n).evaluate(el => el.getBoundingClientRect().left)
  expect(await left(0)).toBeGreaterThan(await left(1)) // first card on the right, second on the left
  expect(await left(2)).toBe(await left(0))
  if (process.env.ROADMAP_SHOTS) {
    await page.screenshot({ path: `${process.env.ROADMAP_SHOTS}/roadmap-1280.png`, fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: `${process.env.ROADMAP_SHOTS}/roadmap-1280-dark.png`, fullPage: true })
    await page.emulateMedia({ colorScheme: 'light' })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await left(0)).toBe(await left(1))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if (process.env.ROADMAP_SHOTS) await page.screenshot({ path: `${process.env.ROADMAP_SHOTS}/roadmap-390.png`, fullPage: true })
})
