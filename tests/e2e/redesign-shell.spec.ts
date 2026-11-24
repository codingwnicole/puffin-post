import { expect, test, type Page } from '@playwright/test'

// Redesign phase 1: folder-drawer sidebar, the active tab joined to the sheet, the phone tab bar and More sheet.
// API is mocked (as in theme.spec.ts); only the shell is under test.
async function signIn(page: Page, unread = 3) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags' || url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: unread }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/')
}

test('desktop: drawers group every page, collapse, and remember their state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  await expect(nav).toBeVisible({ timeout: 15000 })
  for (const name of ['Dashboard', 'Parking lot', 'Characters', 'Character planner', 'Writing tools', 'Connected accounts', 'Settings', 'Site roadmap', 'Support & feedback'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Tumblr activity/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByLabel('3 unread activity items')).toBeVisible()
  // Self-hosted fonts load and are used by the UI and headings (no silent fallback).
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return { ui: getComputedStyle(document.body).fontFamily, figtree: [...document.fonts].some(f => f.family.includes('Figtree') && f.status === 'loaded'), serif: [...document.fonts].some(f => f.family.includes('Young Serif') && f.status === 'loaded') } })
  expect(fonts.ui).toContain('Figtree Variable')
  expect(fonts.figtree).toBe(true)
  expect(fonts.serif).toBe(true)

  const cast = nav.getByRole('button', { name: 'Cast' })
  await cast.click()
  await expect(cast).toHaveAttribute('aria-expanded', 'false')
  await expect(nav.getByRole('link', { name: 'Characters', exact: true })).toHaveAttribute('tabindex', '-1')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Cast' })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: 'Cast' }).click()

  await nav.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
  // The active tab shares the sheet's colour, which is what joins them.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.rd-link[aria-current="page"]')!).backgroundColor === getComputedStyle(document.getElementById('main-content')!).backgroundColor)).toBe(true)
  await page.screenshot({ path: 'test-results/redesign-shell-1440.png' })
})

test('phone: tab bar, More sheet with every other page, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  const bar = page.getByRole('navigation', { name: 'Primary (phone)' })
  await expect(bar).toBeVisible({ timeout: 15000 })
  for (const name of ['Dashboard', 'Parking', 'Characters', 'Tools']) await expect(bar.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeHidden()
  await bar.getByRole('button', { name: /More/ }).click()
  const sheet = page.getByRole('dialog', { name: 'More' })
  await expect(sheet.getByRole('link', { name: /^Tumblr activity/ })).toBeVisible()
  for (const name of ['Character planner', 'Connected accounts', 'Settings', 'Site roadmap', 'Support & feedback']) await expect(sheet.getByRole('link', { name })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  await page.screenshot({ path: 'test-results/redesign-shell-390-more.png' })
  await sheet.getByRole('link', { name: 'Settings' }).click()
  await expect(sheet).toBeHidden()
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  // Tab bar targets stay at least 44px tall.
  const heights = await bar.locator('.rd-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().height))
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'test-results/redesign-shell-390.png' })
})

test('tablet widths: the icon sidebar reaches every page (replaces the old More menu at 761-1024px)', async ({ page }) => {
  await signIn(page, 0)
  for (const width of [761, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
    await expect(nav).toBeVisible({ timeout: 15000 })
    await expect(nav.locator('.rd-link')).toHaveCount(10)
    for (const link of await nav.locator('.rd-link').all()) await expect(link).toBeVisible()
  }
})
