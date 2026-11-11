import { expect, test } from '@playwright/test'

test('shows the Threadums app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Threadums')
  await expect(page.getByRole('heading', { name: 'Threadums', exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Your stories, all in one place.')
})
