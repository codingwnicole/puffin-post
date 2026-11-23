import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('a tracked scene can be archived, found after refresh, and restored without changing its identity', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.12.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  await page.reload()
  const character = await (await page.request.post('/api/characters', { data: { name: 'Wren' } })).json() as { id: string }
  const created = await page.request.post('/api/starters', { data: { characterId: character.id, title: 'A station after midnight', description: 'Two old friends meet at the last train.', partnerName: 'Rowan' } })
  expect(created.status()).toBe(201)
  const starter = await created.json() as { id: string }
  const originalInbox = await (await page.request.get('/api/inbox')).json() as { branches: Array<{ id: string; starterId: string }> }
  const originalBranch = originalInbox.branches.find(branch => branch.starterId === starter.id)
  expect(originalBranch).toBeDefined()
  const originalId = originalBranch!.id

  // Already on #inbox, so goto alone would keep the empty list loaded before the starter existed.
  await page.reload()
  const card = page.locator('.branch-card').first()
  await card.getByRole('button', { name: 'Show scene details' }).click()
  await expect(card.getByRole('button', { name: 'Hide scene details' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Thread details & archive settings' })).toBeVisible()
  await card.getByRole('link', { name: 'Thread details & archive settings' }).click()
  await expect(page.getByRole('button', { name: 'Archive thread' })).toBeVisible()
  await page.getByRole('button', { name: 'Archive thread' }).click()
  await expect(page.getByText('This thread is archived.')).toBeVisible()

  await page.goto('/#inbox?archivedOnly=true')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Archive', exact: true })).toHaveValue('archived')
  const archived = page.locator('.branch-card').first()
  await expect(archived.getByText('Archived thread')).toBeVisible()
  const archivedToggle = archived.getByRole('button', { name: /scene details/ })
  if (await archivedToggle.getAttribute('aria-expanded') === 'false') await archivedToggle.click()
  await expect(archived.getByRole('link', { name: 'Thread details & archive settings' })).toBeVisible()
  await archived.getByRole('link', { name: 'Thread details & archive settings' }).click()
  // The page header's button; an expanded card has its own.
  // The button flips optimistically, so wait for the server before leaving the page.
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/restore') && response.ok()),
    page.getByRole('button', { name: 'Restore thread' }).first().click(),
  ])
  await page.goto('/#inbox')
  await expect(page.locator('.branch-card')).toHaveCount(1)
  const restored = await (await page.request.get('/api/inbox')).json() as { branches: Array<{ id: string }> }
  expect(restored.branches[0].id).toBe(originalId)
  await ctx.close()
})
