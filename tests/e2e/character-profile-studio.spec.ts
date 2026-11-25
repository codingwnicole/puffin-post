import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
const ORIGIN = { origin: APP }
test.use({ baseURL: APP })

test('character profile studio saves privately, publishes approved sections, and fits a phone', async ({ page }) => {
  await createSignedInUser(page, { skipPasswordSetup: true })
  const created = await page.request.post('/api/characters', { data: { name: 'Wren Marlowe' }, headers: ORIGIN })
  expect(created.status()).toBe(201)
  const { id } = await created.json() as { id: string }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#character-profile/${id}`)
  await expect(page.getByRole('heading', { name: 'Public profile studio' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const biography = page.locator('.profile-studio-sections details').filter({ has: page.locator('summary', { hasText: /^Biography$/ }) })
  await biography.locator('summary').click()
  await expect(biography.getByLabel('Show biography')).toBeVisible()
  await biography.getByLabel('Show biography').check()
  await biography.getByRole('textbox', { name: 'Biography' }).fill('Wren is a careful archivist with a stubborn streak.')
  await page.getByRole('button', { name: 'Save private draft' }).click()
  await expect(page.getByRole('status')).toContainText('Draft saved. It is still private')
  await expect(page.getByText('Publish profile')).toBeVisible()

  await page.getByRole('button', { name: 'Publish profile' }).click()
  await expect(page.getByRole('status')).toContainText('Profile published:')
  const publicLink = page.locator('.character-profile-studio a[target="_blank"]').last()
  const publicUrl = await publicLink.getAttribute('href')
  expect(publicUrl).toContain('/c/')
  await page.goto(publicUrl!)
  await expect(page.getByRole('heading', { name: 'Wren Marlowe' })).toBeVisible()
  await expect(page.getByText('Wren is a careful archivist with a stubborn streak.')).toBeVisible()
})

