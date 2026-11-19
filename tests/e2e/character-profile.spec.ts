// Character profile page: moodboard uploads, Pinterest pins, reorder, board link, click-to-load playlist.
import { expect, test, type Page } from '@playwright/test'
import zlib from 'node:zlib'

const APP = 'http://localhost:5173'
const ORIGIN = { origin: APP }
test.use({ baseURL: APP })

// A real 64×64 solid-color PNG built by hand (zlib stored block + correct CRCs).
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 }
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(color: [number, number, number]): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 64, 0, 0, 0, 64, 8, 2, 0, 0, 0]) // 64×64 RGB
  const raw = Buffer.alloc(193 * 64) // per row: filter byte 0 + 64×3 RGB bytes
  for (let y = 0; y < 64; y++) { raw[y * 193] = 0; for (let x = 0; x < 64; x++) { const off = y * 193 + 1 + x * 3; raw[off] = color[0]; raw[off + 1] = color[1]; raw[off + 2] = color[2] } }
  const idat = zlib.deflateSync(raw, { level: 0 }) // zlib-wrapped stored block (browser PNG spec)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

async function signup(page: Page, tag: string) {
  const response = await page.request.post('/api/auth/password-sign-up', { data: { email: `${tag}-${Date.now()}@example.test`, password: 'correct horse battery' }, headers: ORIGIN })
  expect(response.status()).toBe(201)
}

test('profile page: moodboard, pin, reorder, remove, board link, click-to-load playlist', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.3.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) } })
  // Tests never depend on the internet: third-party embed hosts get an empty 200.
  await ctx.route(/(open\.spotify\.com|youtube-nocookie\.com|embed\.music\.apple\.com|assets\.pinterest\.com)/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
  const page = await ctx.newPage()
  await signup(page, 'profile')
  const { id } = await (await page.request.post('/api/characters', { data: { name: 'Wren Marlowe' }, headers: ORIGIN })).json() as { id: string }

  // Enter through the Details card title (the link that used to point at the archived-only shortcut page).
  await page.goto('/#characters'); await page.reload()
  await page.getByRole('link', { name: 'Wren Marlowe' }).click()
  await expect(page).toHaveURL(/#character\/.+/, { timeout: 5000 })
  await expect(page.getByRole('heading', { name: 'Wren Marlowe' })).toBeVisible()

  // Empty moodboard state.
  await expect(page.getByText('Upload 8–12 images that feel like this character, or add pins from Pinterest.')).toBeVisible()
  await expect(page.getByText('2 of 12')).toHaveCount(0)

  // Upload two images (client-side WebP resize runs in the browser; the server sees ≤1200 px).
  const upload = async (name: string, color: [number, number, number]) => {
    const response = page.waitForResponse(r => r.url().includes('/moodboard') && r.request().method() === 'POST' && !r.url().includes('/pin') && !r.url().includes('/order'))
    await page.getByLabel('Moodboard images').setInputFiles({ name, mimeType: 'image/png', buffer: png(color) })
    expect((await response).status()).toBe(201)
  }
  await upload('one.png', [220, 60, 60])
  await expect(page.locator('.profile-tile img')).toHaveCount(1)
  await upload('two.png', [60, 160, 220])
  await expect(page.locator('.profile-tile img')).toHaveCount(2)
  await expect(page.getByText('2 of 12')).toBeVisible()

  // Add a Pinterest pin: its iframe carries the pin id, never cropped.
  await page.getByLabel('Pinterest pin link').fill('https://www.pinterest.com/pin/987654321098/')
  const pinResponse = page.waitForResponse(r => r.url().includes('/moodboard/pin'))
  await page.getByRole('button', { name: 'Add a Pinterest pin' }).click()
  expect((await pinResponse).status()).toBe(201)
  const pinFrame = page.locator('.profile-tile iframe[title="Pinterest pin"]')
  await expect(pinFrame).toHaveAttribute('src', 'https://assets.pinterest.com/ext/embed.html?id=987654321098')
  await expect(page.getByText('3 of 12')).toBeVisible()

  // Reorder: move the first image later → it becomes the second tile.
  await page.locator('.profile-tile').first().getByRole('button', { name: 'Move later' }).click()
  await expect(page.locator('.profile-tile').nth(1).locator('img')).toBeVisible()
  await expect(page.getByText('3 of 12')).toBeVisible()

  // Remove a tile.
  await page.locator('.profile-tile').nth(1).getByRole('button', { name: 'Remove' }).click()
  await expect(page.locator('.profile-tile')).toHaveCount(2)
  await expect(page.getByText('2 of 12')).toBeVisible()

  // Desktop screenshot, then phone width (no horizontal scroll, single column).
  await page.screenshot({ path: 'test-results/profile-1280.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/profile-375.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  // Card editor: playlist + board + tracklist, then the board link card and click-to-load player.
  await page.getByRole('button', { name: 'Edit card' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('Playlist link').fill('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
  await editor.getByLabel('Pinterest board link').fill('https://www.pinterest.com/wren/moodboard-pins/')
  await editor.getByLabel('Track list').fill('Nightcall\nMidnight City')
  await editor.getByRole('button', { name: 'Save card' }).click()
  await expect(editor).toBeHidden()

  const boardLink = page.locator('.profile-board')
  await expect(boardLink).toHaveAttribute('href', 'https://www.pinterest.com/wren/moodboard-pins/')
  await expect(boardLink).toContainText('Full moodboard on Pinterest')
  await expect(boardLink).toContainText('moodboard pins · by www.pinterest.com')
  await expect(page.locator('.profile-tracklist li')).toHaveText(['Nightcall', 'Midnight City'])

  // No playlist iframe before the click.
  await expect(page.locator('.profile-playlist iframe')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Load the Spotify player' })).toBeVisible()
  await page.getByRole('button', { name: 'Load the Spotify player' }).click()
  await expect(page.locator('.profile-playlist iframe')).toHaveAttribute('src', /https:\/\/open\.spotify\.com\/embed\/playlist\//)

  // A bad playlist link shows the server's 400 message in the editor.
  await page.getByRole('button', { name: 'Edit card' }).click()
  await page.getByRole('dialog').getByLabel('Playlist link').fill('https://example.com/not-a-playlist')
  await page.getByRole('dialog').getByRole('button', { name: 'Save card' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // Missing character → friendly error, not an infinite loader.
  await page.goto('/#character/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Character not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to characters' }).click()
  await expect(page).toHaveURL(/#characters/)

  await ctx.close()
})
