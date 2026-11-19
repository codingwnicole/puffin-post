// Deleting an account lands on the signed-out homepage; the Inbox address only carries the view.
import { expect, test } from '@playwright/test'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('Inbox address has no API paging params, and deleting the account returns to the signed-out homepage', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': '10.4.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  expect((await page.request.post('/api/auth/password-sign-up', { data: { email: `bye-${Date.now()}@example.test`, password: 'correct horse battery' } })).status()).toBe(201)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForTimeout(300)
  expect(new URL(page.url()).hash).toBe('#inbox')
  await page.goto('/#inbox?status=your_turn'); await page.reload(); await page.waitForTimeout(300)
  expect(new URL(page.url()).hash).toBe('#inbox?status=your_turn')
  await page.goto('/#settings'); await page.reload()
  await page.getByPlaceholder('DELETE').fill('DELETE')
  await page.getByRole('button', { name: 'Delete account' }).click()
  await page.waitForURL(url => url.pathname === '/' && url.hash === '')
  expect((await page.request.get('/api/auth/session')).status()).not.toBe(200)
  await ctx.close()
})
