// Deleting an account lands on the signed-out homepage; the Inbox address only carries the view.
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('the homepage keeps a clean URL and direct inbox routes survive back and forward navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Keep track of what you owe.' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')

  await page.goto('/#inbox?status=their_turn')
  await expect(page.getByRole('heading', { name: 'Keep track of what you owe.' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#inbox?status=their_turn') // signed out, old #inbox links are left as typed
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  expect(new URL(page.url()).hash).toBe('')
  await page.goForward()
  await expect(page).toHaveURL(/#inbox\?status=their_turn$/)
})

test('Dashboard address has no API paging params, and deleting the account returns to the signed-out homepage', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': '10.4.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForTimeout(300)
  expect(new URL(page.url()).hash).toBe('#dashboard')
  await page.goto('/#inbox?status=your_turn'); await page.reload(); await page.waitForTimeout(300)
  expect(new URL(page.url()).hash).toBe('#dashboard?status=your_turn')
  await page.goto('/#settings'); await page.reload()
  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page.getByRole('button', { name: 'Delete account' }).click()
  await page.waitForURL(url => url.pathname === '/' && url.hash === '')
  expect((await page.request.get('/api/auth/session')).status()).not.toBe(200)
  await ctx.close()
})
