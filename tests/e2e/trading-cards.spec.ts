// Trading cards on the Characters page: make one, flip it, download it (real Worker + local D1).
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'
import gifenc from 'gifenc' // CommonJS in Node
const { GIFEncoder } = gifenc

// A real 3-frame 64×64 animated GIF (red, green, blue).
function animatedGif() {
  const gif = GIFEncoder()
  for (const [i, colour] of [[255, 0, 0], [0, 160, 0], [0, 0, 255]].entries()) gif.writeFrame(new Uint8Array(64 * 64), 64, 64, { palette: [colour, [0, 0, 0]], delay: 200, ...(i ? {} : { repeat: 0 }) })
  gif.finish(); return Buffer.from(gif.bytes())
}
const frameCount = (bytes: Buffer) => { let n = 0; for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) n++; return n }
const download = async (page: import('@playwright/test').Page, button: import('@playwright/test').Locator) => { const [file] = await Promise.all([page.waitForEvent('download'), button.click()]); return { name: file.suggestedFilename(), bytes: Buffer.concat(await (await file.createReadStream()).toArray()), file } }

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

test('make a trading card, see it in the Cards view, flip it, and download it as an animated GIF or a PNG', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.3.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#inbox')
  await createSignedInUser(page)
  const { id } = await (await page.request.post('/api/characters', { data: { name: 'Wren Marlowe' } })).json() as { id: string }
  await page.request.post('/api/starters', { data: { characterId: id, title: 'Harbor at dusk', partnerName: 'Ash' } })
  await page.goto('/#characters'); await page.reload()
  const detailsTile = page.locator('.character-card').first()
  await expect(detailsTile.getByRole('button', { name: 'Make trading card' })).toBeVisible()
  await page.getByRole('button', { name: 'Make or edit a card' }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a character' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Continue' }).click()
  const pickerEditor = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Save card' }) })
  await expect(pickerEditor).toBeVisible()
  await pickerEditor.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  const tile = page.locator('.tcard-tile').first()
  await tile.getByRole('button', { name: 'Make a card' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByText('Vamp Romantic').click()
  // No sparkle by default; the symbol picker puts the chosen glyph by the name.
  await expect(editor.locator('[data-side=front] [data-symbol]')).toHaveCount(0)
  await editor.getByRole('radio', { name: 'Moon' }).check()
  await expect(editor.locator('[data-side=front] [data-symbol]').first()).toHaveText('☾')
  await editor.getByLabel('Name on card').fill('Little Fox')
  // A GIF portrait goes up untouched (animation kept) and shows on the card; the size hint is visible.
  await expect(editor.locator('#portrait-hint')).toContainText('600 × 600')
  const uploaded = page.waitForResponse(r => r.url().endsWith('/portrait') && r.request().method() === 'POST')
  await editor.locator('input[type=file]').first().setInputFiles({ name: 'wren.gif', mimeType: 'image/gif', buffer: animatedGif() })
  expect((await uploaded).status()).toBe(201)
  await expect(editor.locator('[data-side=front] image')).toHaveCount(1)
  expect((await page.request.get(`/api/characters/${id}/portrait`)).headers()['content-type']).toBe('image/gif')
  await editor.getByLabel('Quote').fill('I keep my promises, even the bad ones.')
  await editor.getByRole('tab', { name: 'Back' }).click()
  await editor.getByLabel('Fun fact 1').fill('Hates the rain')
  await expect(editor.locator('.tcard')).toHaveAttribute('data-theme-id', 'vamp')
  await page.screenshot({ path: 'test-results/cards-editor-1280.png' })
  await editor.getByRole('button', { name: 'Save card' }).click()
  await expect(editor).toBeHidden()
  await expect(tile.locator('.tcard')).toHaveAttribute('data-theme-id', 'vamp')
  await expect(tile.locator('[data-side=front]')).toContainText('Little Fox')
  await expect(tile.locator('[data-side=front] [data-symbol]').first()).toHaveText('☾')
  await expect(tile.locator('[data-side=back]')).toContainText('Hates the rain')
  await expect(tile.locator('[data-side=back]')).toContainText('YOUR TURN')
  const flip = tile.getByRole('button', { name: /Flip Wren Marlowe/ })
  await flip.click(); await expect(flip).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(800); await page.screenshot({ path: 'test-results/cards-view-back-1280.png' })
  await flip.press('Enter'); await expect(flip).toHaveAttribute('aria-pressed', 'false')
  // GIF portrait → animated GIF download (both sides, 1320 × 860, every frame kept).
  const gifOut = await download(page, tile.getByRole('button', { name: 'Download' }))
  expect(gifOut.name).toBe('wren-marlowe-rp-thread-buddy-card.gif')
  expect(gifOut.bytes.subarray(0, 6).toString()).toBe('GIF89a')
  expect(gifOut.bytes.readUInt16LE(6)).toBe(1320); expect(gifOut.bytes.readUInt16LE(8)).toBe(860)
  expect(frameCount(gifOut.bytes)).toBe(3)
  expect(gifOut.bytes.length).toBeLessThan(3_000_000)
  await gifOut.file.saveAs('test-results/cards-download.gif')
  // Decode the downloaded GIF in the browser: frame 3 shows the blue portrait and the card around it is intact.
  const pixels = await page.evaluate(async b64 => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), decoder = new ImageDecoder({ data, type: 'image/gif' })
    const { image } = await decoder.decode({ frameIndex: 2 }), canvas = new OffscreenCanvas(1320, 860), context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0); const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
    return { portrait: at(320, 235), name: at(300, 455), back: at(1000, 160) }
  }, gifOut.bytes.toString('base64'))
  expect(pixels.portrait[2]).toBeGreaterThan(200); expect(pixels.portrait[0]).toBeLessThan(40)
  expect(pixels.back.some(v => v > 0)).toBe(true)
  await expect(tile.getByRole('status')).toHaveText('Saved as an animated GIF.')
  // No portrait (or a still one) → PNG at 2640 × 1720.
  await page.request.delete(`/api/characters/${id}/portrait`); await page.reload()
  const pngOut = await download(page, page.locator('.tcard-tile').first().getByRole('button', { name: 'Download' }))
  expect(pngOut.name).toBe('wren-marlowe-rp-thread-buddy-card.png')
  expect(pngOut.bytes.subarray(1, 4).toString()).toBe('PNG'); expect(pngOut.bytes.readUInt32BE(16)).toBe(2640); expect(pngOut.bytes.readUInt32BE(20)).toBe(1720)
  await pngOut.file.saveAs('test-results/cards-download.png')
  // The choice of view is remembered.
  await page.reload(); await expect(page.locator('.tcard-tile')).toHaveCount(1)
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: 'test-results/cards-view-375.png', fullPage: true })
  await ctx.close()
})
