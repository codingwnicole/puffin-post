import { expect, test } from '@playwright/test'

test('shows the Puffin Post app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Puffin Post')
  await expect(page.getByRole('link', { name: 'Puffin Post', exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Keep every thread moving.')
})
