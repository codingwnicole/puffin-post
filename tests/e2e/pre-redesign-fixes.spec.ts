// Checks for the pre-redesign frontend fixes (docs/frontend-architecture.md).
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

async function signedIn(browser: import('@playwright/test').Browser, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: APP, viewport, extraHTTPHeaders: { 'cf-connecting-ip': '10.7.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  return { ctx, page }
}

test('empty inbox offers the add-thread form; a filter with no matches keeps its filters', async ({ browser }) => {
  const { ctx, page } = await signedIn(browser)
  await page.goto('/#inbox'); await page.reload()
  await expect(page.locator('.onboarding')).toBeVisible()
  // The hero link opens the add-thread panel (it is shown via :target); it used to point at nothing.
  await page.getByRole('link', { name: '+ Add a thread' }).click()
  await expect(page.locator('#quick-add').getByLabel(/Scene label/)).toBeVisible()
  await page.goto('/#inbox?status=their_turn'); await page.reload()
  await expect(page.getByRole('heading', { name: 'No scenes match these filters' })).toBeVisible()
  await expect(page.locator('.filter-bar select').first()).toHaveValue('their_turn')
  await ctx.close()
})

test('card editor asks before Escape throws away edits, and keeps focus inside', async ({ browser }) => {
  const { ctx, page } = await signedIn(browser)
  await page.request.post('/api/characters', { data: { name: 'Wren' } })
  await page.goto('/#characters'); await page.reload()
  await page.getByRole('button', { name: '✦ Cards' }).click()
  const opener = page.locator('.tcard-tile').first().getByRole('button', { name: 'Make a card' })
  await opener.click()
  const editor = page.getByRole('dialog')
  await expect(editor).toBeVisible()
  expect(await editor.evaluate(el => el.contains(document.activeElement))).toBe(true)

  // Unchanged card: Escape closes straight away and focus returns to the opener.
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(opener).toBeFocused()

  // Changed card: Escape asks; dismissing the question keeps the editor and the text.
  await opener.click()
  await editor.getByLabel('Quote').fill('Unsaved words')
  page.once('dialog', dialog => void dialog.dismiss())
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Quote')).toHaveValue('Unsaved words')
  page.once('dialog', dialog => void dialog.accept())
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await ctx.close()
})

test('command menu keeps Tab inside and returns focus on close', async ({ browser }) => {
  const { ctx, page } = await signedIn(browser)
  await page.goto('/#inbox'); await page.reload()
  const hint = page.locator('.rd-side .rd-search')
  await hint.click()
  const menu = page.getByRole('dialog', { name: 'Command menu' })
  await expect(menu.locator('input')).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await menu.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(hint).toBeFocused()
  await ctx.close()
})

test('the phone quick note is saved to the Parking Lot on Enter', async ({ browser }) => {
  const { ctx, page } = await signedIn(browser, { width: 390, height: 844 })
  await page.goto('/#inbox'); await page.reload()
  await page.locator('.rd-more-toggle').click()
  const note = page.locator('.rd-more-sheet .rd-sheet-note')
  await note.fill('Ask Ash about the heist')
  await note.press('Enter')
  await expect(page.locator('.rd-sheet-notice')).toHaveText('Saved to your Parking Lot')
  await expect(note).toHaveValue('')
  const drafts = await (await page.request.get('/api/reply-drafts')).json() as { title: string; purpose: string }[]
  expect(drafts.some(draft => draft.title === 'Ask Ash about the heist' && draft.purpose === 'note')).toBe(true)
  await ctx.close()
})
