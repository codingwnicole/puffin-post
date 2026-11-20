// Public share: create a character, enable sharing, verify public page, embed, snippets, rotate, disable.
import { expect, test } from '@playwright/test'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('share lifecycle: enable, public page, snippets, rotate, disable', async ({ browser }) => {
  // Authenticated context
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.4.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  expect((await page.request.post('/api/auth/password-sign-up', { data: { email: `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`, password: 'correct horse battery' } })).status()).toBe(201)
  const { id } = await (await page.request.post('/api/characters', { data: { name: 'Sage Blackthorn' } })).json() as { id: string }
  await page.request.post('/api/starters', { data: { characterId: id, title: 'Midnight library', partnerName: 'Ivy' } })

  // Create a card for the character
  await page.request.put(`/api/characters/${id}/card`, { data: { theme: 'holo', nickname: 'Sage', age: '24', birthdate: 'Feb 12', quote: 'All stories find an ending.', song: '', artist: '', favoriteColor: '#7c5cbf', facts: ['Reads too much'], likes: 'rain', dislikes: 'silence', notes: '', playlistUrl: '', boardUrl: '', tracklist: [], symbol: 'none' } })

  // Open profile page and open Share panel
  await page.goto(`/#character/${id}`); await page.reload()
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: /Share Sage Blackthorn/ })
  await expect(dialog).toBeVisible()

  // Enable sharing with trading card style (default)
  await dialog.getByLabel('Share this character publicly').click()
  // The toggle fires save() which creates the share; wait for the UI to show the settings
  await expect(dialog.getByText('Save settings')).toBeVisible()

  // Should now show snippets
  await expect(dialog.getByText('Embed snippets')).toBeVisible()

  // Extract slug from the link snippet
  const linkInput = dialog.locator('.share-snippet input').first()
  const shareUrl = await linkInput.inputValue()
  expect(shareUrl).toContain('/c/')
  const slug = shareUrl.split('/c/')[1]
  expect(slug.length).toBeGreaterThan(0)

  // Assert preview upload happened (card.png exists)
  const previewResponse = await page.request.get(`/c/${slug}/card.png`)
  expect(previewResponse.status()).toBe(200)
  expect(previewResponse.headers()['content-type']).toBe('image/png')

  // Open public page in a fresh context WITHOUT cookies
  const publicCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const publicPage = await publicCtx.newPage()
  const response = await publicPage.goto(`${APP}/c/${slug}`)
  expect(response!.status()).toBe(200)
  // X-Robots-Tag should be noindex (indexable defaults to false)
  expect(response!.headers()['x-robots-tag']).toContain('noindex')
  // Name visible
  await expect(publicPage.locator('h1')).toContainText('Sage Blackthorn')
  // No stats when showStats is off
  await expect(publicPage.locator('body')).not.toContainText('Thread Stats')
  // Screenshot at 1280
  await publicPage.screenshot({ path: 'test-results/share-public-1280.png' })
  // Screenshot at 375
  await publicPage.setViewportSize({ width: 375, height: 812 })
  await publicPage.screenshot({ path: 'test-results/share-public-375.png', fullPage: true })
  await publicCtx.close()

  // Turn stats on → stats visible on public page
  await dialog.getByLabel('Show thread stats').check()
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await page.waitForTimeout(500)
  const publicCtx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const publicPage2 = await publicCtx2.newPage()
  await publicPage2.goto(`${APP}/c/${slug}`)
  await expect(publicPage2.locator('body')).toContainText('Thread Stats')
  await publicCtx2.close()

  // Switch to simple style
  await dialog.getByLabel('Simple card (icon, name, stats)').check()
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await page.waitForTimeout(500)
  const publicCtx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const publicPage3 = await publicCtx3.newPage()
  await publicPage3.goto(`${APP}/c/${slug}`)
  // Simple card renders — portrait circle, no SVG card
  await expect(publicPage3.locator('h1')).toContainText('Sage Blackthorn')
  await expect(publicPage3.locator('svg[data-side=front]')).toHaveCount(0)
  await publicCtx3.close()

  // Copy snippets: each field value contains the slug
  const snippetInputs = dialog.locator('.share-snippet input')
  const snippetCount = await snippetInputs.count()
  expect(snippetCount).toBe(5)
  for (let i = 0; i < snippetCount; i++) {
    const value = await snippetInputs.nth(i).inputValue()
    expect(value).toContain(slug)
  }

  // Embed at 340×480
  const embedCtx = await browser.newContext({ viewport: { width: 340, height: 480 } })
  const embedPage = await embedCtx.newPage()
  // Switch back to card style so we can test the card embed
  await dialog.getByLabel('Trading card').check()
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await page.waitForTimeout(500)
  // Re-read slug in case it changed
  const updatedSlug = (await linkInput.inputValue()).split('/c/')[1]
  await embedPage.goto(`${APP}/c/${updatedSlug}/embed`)
  await embedPage.screenshot({ path: 'test-results/share-embed-340x480.png' })
  await embedCtx.close()

  // New link → old slug 404
  const oldSlug = updatedSlug
  page.once('dialog', d => d.accept())
  await dialog.getByRole('button', { name: 'New link' }).click()
  await page.waitForTimeout(500)
  const newShareUrl = await linkInput.inputValue()
  const newSlug = newShareUrl.split('/c/')[1]
  expect(newSlug).not.toBe(oldSlug)
  const oldResponse = await page.request.get(`/c/${oldSlug}`)
  expect(oldResponse.status()).toBe(404)

  // Turn sharing off → 404
  page.once('dialog', d => d.accept())
  await dialog.getByLabel('Share this character publicly').click()
  await page.waitForTimeout(500)
  const offResponse = await page.request.get(`/c/${newSlug}`)
  expect(offResponse.status()).toBe(404)

  await ctx.close()
})
