// Regression: on phones the More menus must stay open after a tap and close on demand
// (simulated touch phone; the real-device check is still the owner's).
import { expect, test, devices } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('More menus on a touch phone open on tap, stay open, and close on demand', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': '10.2.1.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  await page.request.post('/api/characters', { data: { name: 'Wren' } })
  await page.goto('/#characters'); await page.reload()
  const nav = page.locator('.mobile-more')
  await nav.locator('.mobile-more-toggle').tap()
  await page.waitForTimeout(600)
  await expect(nav).toHaveClass(/is-open/)
  await expect(nav.locator('.mobile-more-toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.sheet-close').tap()
  await expect(nav).not.toHaveClass(/is-open/)
  await nav.locator('.mobile-more-toggle').tap()
  await expect(nav).toHaveClass(/is-open/)
  await nav.locator('.mobile-more-toggle').tap()
  await expect(nav).not.toHaveClass(/is-open/)
  const card = page.locator('.character-more').first()
  await card.locator('> summary').tap()
  await page.waitForTimeout(600)
  await expect(card).toHaveAttribute('open', '')
  await expect(card.getByRole('button', { name: 'Remove character' })).toBeVisible()
  await ctx.close()
})
