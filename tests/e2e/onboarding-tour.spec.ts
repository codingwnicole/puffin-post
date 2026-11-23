import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('the optional walkthrough resumes, exits by keyboard, restarts, and completes without sample records', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 375, height: 812 } })
  const page = await ctx.newPage()
  await page.goto('/#settings')
  await createSignedInUser(page)
  await page.reload()
  await expect(page.locator('dialog.onboarding-overlay')).toHaveCount(0)

  const charactersBefore = await (await page.request.get('/api/characters')).json()
  const inboxBefore = await (await page.request.get('/api/inbox')).json()
  await page.getByRole('button', { name: 'Restart the walkthrough' }).click()
  const dialog = page.locator('dialog.onboarding-overlay')
  await expect(dialog.getByRole('heading', { name: 'Your dashboard is the reply desk' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByText('Step 2 of 6')).toBeVisible()

  await page.reload()
  const resumed = page.locator('dialog.onboarding-overlay')
  await expect(resumed.getByText('Step 2 of 6')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.onboarding-overlay')).toHaveCount(0)

  await page.getByRole('button', { name: 'Restart the walkthrough' }).click()
  const restarted = page.locator('dialog.onboarding-overlay')
  await expect(restarted.getByText('Step 1 of 6')).toBeVisible()
  for (let step = 0; step < 5; step++) await restarted.getByRole('button', { name: 'Next' }).click()
  await restarted.getByRole('button', { name: 'Finish tour' }).click()
  await expect(page.locator('dialog.onboarding-overlay')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rptb-tour-completed'))).toBe('v1')
  expect(await (await page.request.get('/api/characters')).json()).toEqual(charactersBefore)
  const inboxAfter = await (await page.request.get('/api/inbox')).json() as { branches: unknown[] }
  expect(inboxAfter.branches).toEqual((inboxBefore as { branches: unknown[] }).branches)
  await ctx.close()
})
