// Regression checks for the 2026-11-21 functional reliability pass.
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('a failed session probe (5xx or offline) keeps the signed-in shell instead of showing the guest page', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  await page.reload()
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('/#characters')
  await page.waitForResponse(response => response.url().includes('/api/auth/session'))
  await expect(nav).toBeVisible()
  await page.unroute('**/api/auth/session')
  await page.route('**/api/auth/session', route => route.abort())
  await page.goto('/#parking-lot')
  await expect(nav).toBeVisible()
  await ctx.close()
})
