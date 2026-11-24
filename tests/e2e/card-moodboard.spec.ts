// The moodboard side of a trading card: a third face with the uploaded images, and a
// download that stays front + back (the mood side is on-screen only; the export never swaps the printable back).
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'
import gifenc from 'gifenc' // CommonJS in Node
const { GIFEncoder } = gifenc

// A real 3-frame 64×64 animated GIF (red, green, blue) for the portrait.
function animatedGif() {
  const gif = GIFEncoder()
  for (const [i, colour] of [[255, 0, 0], [0, 160, 0], [0, 0, 255]].entries()) gif.writeFrame(new Uint8Array(64 * 64), 64, 64, { palette: [colour, [0, 0, 0]], delay: 200, ...(i ? {} : { repeat: 0 }) })
  gif.finish(); return Buffer.from(gif.bytes())
}
const frameCount = (bytes: Buffer) => { let n = 0; for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) n++; return n }
// Three solid-colour 40×40 PNGs (base64) so the mood tiles are visually distinct and the spec
// stays dependency-free (no zlib / no runtime PNG construction).
const moodPngs = [
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMUlEQVR4nO3NQQkAAAgEMONcCPtjLEsIfgb7ryb9osRisVgsFovFYrFYLBaLxeKcxQso5FNq0IH+ggAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMUlEQVR4nO3NQQkAAAgEMOOYyYiX0hKCn8H+q868KLFYLBaLxWKxWCwWi8VisThn8QKFGVNq+2poIQAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMklEQVR4nO3NQQkAAAgEMDMZ4voHMIwlBD+D/VedeVFisVgsFovFYrFYLBaLxWJxzuIFaXBNecEEozUAAAAASUVORK5CYII='
]
const download = async (page: import('@playwright/test').Page, button: import('@playwright/test').Locator) => { const [file] = await Promise.all([page.waitForEvent('download'), button.click()]); return { name: file.suggestedFilename(), bytes: Buffer.concat(await (await file.createReadStream()).toArray()), file } }

const APP = 'http://localhost:5173'
const ORIGIN = { origin: APP }
test.use({ baseURL: APP })

// Upload three moodboard images through the API, from the page context (FormData + File exist there).
async function seedMoodboard(page: import('@playwright/test').Page, id: string) {
  for (const b64 of moodPngs) {
    const status = await page.evaluate(async dataUrl => {
      const blob = await (await fetch(dataUrl)).blob()
      const form = new FormData()
      form.append('image', new File([blob], 'mood.png', { type: 'image/png' }))
      const response = await fetch('/api/characters/' + (window as unknown as { __cardId?: string }).__cardId! + '/moodboard', { method: 'POST', body: form })
      return response.status
    }, 'data:image/png;base64,' + b64)
    expect(status).toBe(201)
  }
  await expect.poll(async () => (await page.evaluate(async () => {
    const board = await (await fetch('/api/characters/' + (window as unknown as { __cardId?: string }).__cardId! + '/moodboard')).json()
    return (Array.isArray(board) ? board : (board as { items?: unknown[] }).items ?? []).length
  }) as unknown as Promise<number>)).toBe(3)
}

test('a card with a moodboard keeps a hidden mood side and a front + back download', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.3.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await createSignedInUser(page)
  const { id } = await (await page.request.post('/api/characters', { data: { name: 'Sable Vane' }, headers: ORIGIN })).json() as { id: string }
  await page.goto('/#characters'); await page.reload()
  await page.evaluate(cid => { (window as unknown as { __cardId?: string }).__cardId = cid }, id)
  await seedMoodboard(page, id)
  // Cards view only draws card art (portrait, mood side) once the character has a card.
  expect((await page.request.put('/api/characters/' + id + '/card', { data: {}, headers: ORIGIN })).ok()).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  const tile = page.locator('.tcard-tile').first()
  const card = tile.locator('.tcard')
  const flip = tile.getByRole('button', { name: /Flip Sable Vane/ })

  // Wait for the moodboard data to load (the hidden mood face appears).
  await expect(card.locator('.tcard-mood')).toBeAttached({ timeout: 10000 })

  // The card flips between two physical faces; the mood side is a hidden raster-only copy
  // that the download draws (a third flip face flashed mid-turn, so it was taken out of the flip).
  await expect(flip).toHaveAttribute('aria-pressed', 'false')
  await expect(flip).toHaveAttribute('aria-label', /to the back/i)
  const moodSvg = card.locator('.tcard-mood [data-side=mood]')
  await expect(moodSvg).toContainText('MOODBOARD')
  await expect(moodSvg.locator('image')).toHaveCount(3)
  await flip.click(); await expect(flip).toHaveAttribute('aria-pressed', 'true')
  await expect(flip).toHaveAttribute('aria-label', /to the front/i)
  await flip.click(); await expect(flip).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: 'test-results/mood-cards-view-1280.png' })

  // No portrait (or a still one) + moodboard → the same two-panel PNG as any card.
  const pngOut = await download(page, tile.getByRole('button', { name: 'Download' }))
  expect(pngOut.name).toBe('sable-vane-rp-thread-buddy-card.png')
  expect(pngOut.bytes.subarray(1, 4).toString()).toBe('PNG'); expect(pngOut.bytes.readUInt32BE(16)).toBe(2640); expect(pngOut.bytes.readUInt32BE(20)).toBe(1720)
  await pngOut.file.saveAs('test-results/mood-card-download.png')
  await expect(tile.getByRole('status')).toContainText('Saved as a PNG.')

  // A GIF portrait + moodboard → a two-panel animated GIF, 1320 wide, keeping the portrait's 3 frames.
  await tile.getByRole('button', { name: 'Edit card' }).click()
  const dialog = page.getByRole('dialog')
  const uploaded = page.waitForResponse(r => r.url().endsWith('/portrait') && r.request().method() === 'POST')
  await dialog.locator('input[type=file]').first().setInputFiles({ name: 'sable.gif', mimeType: 'image/gif', buffer: animatedGif() })
  expect((await uploaded).status()).toBe(201)
  await dialog.getByRole('button', { name: 'Save card' }).click()
  await expect(dialog).toBeHidden()
  const gifOut = await download(page, tile.getByRole('button', { name: 'Download' }))
  expect(gifOut.name).toBe('sable-vane-rp-thread-buddy-card.gif')
  expect(gifOut.bytes.subarray(0, 6).toString()).toBe('GIF89a')
  expect(gifOut.bytes.readUInt16LE(6)).toBe(1320); expect(gifOut.bytes.readUInt16LE(8)).toBe(860)
  expect(frameCount(gifOut.bytes)).toBe(3)
  await gifOut.file.saveAs('test-results/mood-card-download.gif')
  await expect(tile.getByRole('status')).toContainText('Saved as an animated GIF.')
  await ctx.close()
})
