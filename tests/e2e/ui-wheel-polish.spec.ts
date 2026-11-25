import { renderPage } from '../../src/routes/public-share'
import { emptyCard, THEMES } from '../../src/web/components/TradingCard'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const scene = {
  id: 'b1', starterId: 's1', title: 'Harbor at dusk', characterId: 'c1', characterName: 'Wren', partnerLabel: 'ash.tumblr.com',
  partnerId: null, status: 'your_turn', notes: '', rootPostId: '100', rootBlogId: 'wren.tumblr.com', latestPostId: '201', lastPoster: 'ash.tumblr.com',
  description: 'Rain on the docks, a lamp left burning.', lastActivityAt: '2026-11-20T00:00:00Z', latestReplyExcerpt: 'The ledger lay open.',
  partnerMuses: [], userRecap: '', nextCheckAt: null, groupId: null, groupName: null, archivedAt: null, starterArchived: 0, refreshError: null, iconObjectKey: null,
}
const characters = [{ id: 'c1', name: 'Wren', state: 'active', notes: '', card: null, threadCounts: { total: 2, mine: 2, theirs: 0 } }]
const draft = { id: 'd1', title: 'Rainy evening reply', notes: 'A half-written reply worth coming back to.', purpose: 'reply', characterIds: [], characterId: null, state: 'open', updatedAt: '2026-11-20', sourceUrl: null, reminderAt: null }

const runtimeErrors = new WeakMap<Page, string[]>()
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]) })

// Optional offline harness serves the real production bundle from disk. API mocks below remain identical.
// This supports locked-down environments whose Node processes cannot connect to localhost.
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && /React|validateDOMNesting|Warning:/.test(message.text())) errors.push(message.text()) })
  if (!process.env.UI_TEST_DIST) return
  const root = resolve(process.env.UI_TEST_DIST)
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) return route.fallback()
    const pathname = decodeURIComponent(url.pathname)
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + sep)) return route.abort()
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
    try { await route.fulfill({ contentType: type, body: await readFile(file) }) } catch { await route.fulfill({ status: 404, body: '' }) }
  })
})

async function mock(page: Page, branches = [scene, { ...scene, id: 'b2', title: 'Library heist', partnerLabel: 'mira.tumblr.com', latestPostId: '202', lastPoster: 'mira.tumblr.com' }], drafts = [draft]) {
  await page.addInitScript(() => { Math.random = () => .75; localStorage.setItem('puffin-cookie-notice', 'dismissed') })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = []
    if (path === '/api/auth/session') body = { user: { id: 'u1' } }
    else if (path === '/api/sprints/stats') body = { timezone: 'UTC', today: { words: 0, replies: 0, sessions: 0 }, thisWeek: { words: 0, replies: 0, sessions: 0 }, allTime: { words: 0, replies: 0, sessions: 0 }, mostRecent: null }
    else if (path === '/api/activity-requirements') body = { groups: [], characters: [], blogs: [], requirements: [] }
    else if (path === '/api/notifications/preferences') body = { inAppEnabled: true, pushEnabled: false, pushDevices: 0, globalMuted: false, notifyReplies: true, notifyReminders: true, notifyPossibleThreads: true, notifyActivityRequirements: true, timezone: 'UTC', quietStartLocal: null, quietEndLocal: null, emailAvailable: false }
    else if (path === '/api/inbox') body = { branches, yourTurnCount: branches.filter(row => row.status === 'your_turn').length, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (path === '/api/starters/options') body = { characters, partners: [], groups: [] }
    else if (path === '/api/characters') body = characters
    else if (path === '/api/settings') body = { connections: [], workspaces: [], user: { email: 'writer@example.test' }, refresh: {} }
    else if (path === '/api/support') body = { items: [], canManage: false }
    else if (path === '/api/roadmap') body = { items: [], canManage: false }
    else if (path === '/api/tumblr-activity') body = { asks: [], mentions: [], threadCandidates: [], blogs: [], diagnostics: [] }
    else if (path === '/api/character-planner') body = { plans: [], hasMore: false, nextCursor: null }
    else if (path === '/api/reply-drafts') body = drafts
    else if (path === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ json: body })
  })
}
async function openWheel(page: Page, route = 'dashboard') {
  await page.goto('/#' + route)
  await expect(page.locator('main h1')).toHaveText(route === 'dashboard' ? 'Your turn' : 'Parking Lot')
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click()
  return page.getByRole('dialog', { name: route === 'dashboard' ? 'Pick your next reply' : 'Pick something from the Parking Lot' })
}

test('Details stays still through hover, pointer press and keyboard focus', async ({ page }) => {
  await mock(page)
  await page.goto('/#dashboard')
  const trigger = page.getByRole('button', { name: /Show scene details: Harbor/ })
  const hint = trigger.locator('.scene-card-hint')
  await hint.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  const before = await hint.boundingBox()
  await hint.hover()
  await expect.poll(async () => (await hint.boundingBox())?.y).toBe(before!.y)
  const after = await hint.boundingBox()
  expect(after).toEqual(before)
  await page.mouse.down()
  expect(await hint.boundingBox()).toEqual(before)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'Harbor at dusk' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  expect(await hint.boundingBox()).toEqual(before)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Harbor at dusk' })).toBeVisible()
})

test('wheel opens before spinning, traps focus, picks the exact partner branch and preserves the result', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page)
  const dialog = await openWheel(page)
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toHaveCount(0)
  const beforeSpin = await dialog.boundingBox()
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toBeVisible()
  expect((await dialog.boundingBox())!.height).toBeCloseTo(beforeSpin!.height, 0)
  const link = dialog.getByRole('link', { name: 'Open on Tumblr' })
  await expect(link).toHaveAttribute('href', 'https://www.tumblr.com/mira/202')
  await expect(link).toHaveAttribute('target', '_blank')
  await context.route('https://www.tumblr.com/**', route => route.fulfill({ body: 'Reply destination' }))
  const popup = page.waitForEvent('popup')
  await link.click()
  const replyTab = await popup
  await expect(replyTab).toHaveURL('https://www.tumblr.com/mira/202')
  await replyTab.close()
  await page.bringToFront()
  await expect(page).toHaveURL(/#dashboard$/)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await expect(dialog).toContainText(/Link copied|Use the link menu/)
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab')
    // Native dialogs may tab into browser chrome; they must never focus a background control.
    expect(await dialog.evaluate(el => document.activeElement === document.body || el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeFocused()
  await page.getByRole('button', { name: 'Spin the wheel' }).click()
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toBeVisible()
})

test('animation cannot double-spin, matches the visible winner, and cancels cleanly on close', async ({ page }) => {
  await mock(page)
  const dialog = await openWheel(page)
  const spin = dialog.getByRole('button', { name: 'Spin', exact: true })
  await spin.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click() })
  await expect(dialog.getByRole('button', { name: 'Spinning…' })).toBeDisabled()
  const rotation = Number(await dialog.locator('.spin-face').getAttribute('data-rotation'))
  expect(rotation).toBe(1890)
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toBeVisible({ timeout: 5000 })
  await expect(dialog.locator('.is-win')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Spin Again' }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Spin the wheel' }).click()
  await expect(dialog.getByRole('button', { name: 'Spin', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toHaveCount(0)
})

for (const purpose of ['reply', 'starter_idea', 'plotting', 'note']) {
  test(`Parking Lot ${purpose} opens its own editor without a Tumblr detour`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mock(page, [scene], [{ ...draft, purpose }])
    const dialog = await openWheel(page, 'parking-lot')
    await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
    await expect(dialog.getByRole('link', { name: 'Open on Tumblr' })).toHaveCount(0)
    const action = { reply: 'Open Draft', starter_idea: 'View Idea', plotting: 'Open Plot', note: 'Open Note' }[purpose]
    await dialog.getByRole('button', { name: action, exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-pick-id="d1"]').getByLabel('Draft title', { exact: true })).toHaveValue(draft.title)
    await expect(page.locator('[data-pick-id="d1"]').getByLabel('Draft title', { exact: true })).toBeFocused()
    await expect(page).toHaveURL(/#parking-lot$/)
  })
}

test('empty wheels are explained and disabled', async ({ page }) => {
  await mock(page, [{ ...scene, status: 'their_turn' }], [])
  await page.goto('/#dashboard')
  await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeDisabled()
  await expect(page.locator('.spin-wheel > p').filter({ hasText: 'Nothing is your turn here right now. Enjoy the quiet.' })).toBeVisible()
  await page.goto('/#parking-lot')
  await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeDisabled()
})

test('archiving an edited draft saves its current writing before clearing the local backup', async ({ page }) => {
  await mock(page)
  let archived = false
  let patch: { notes?: string; state?: string } = {}
  await page.route('**/api/reply-drafts', route => route.fulfill({json:archived ? [] : [draft]}))
  await page.route('**/api/reply-drafts/d1', route => {
    patch = route.request().postDataJSON(); archived = true
    return route.fulfill({json:{...draft,...patch}})
  })
  const dialog = await openWheel(page, 'parking-lot')
  await dialog.getByRole('button', {name:'Spin',exact:true}).click()
  await dialog.getByRole('button', {name:'Open Draft',exact:true}).click()
  const card = page.locator('[data-pick-id="d1"]')
  await card.locator('textarea[name=notes]').fill('New writing that has not been saved yet.')
  await card.getByRole('button', {name:'Archive draft',exact:true}).click()
  await expect(card).toHaveCount(0)
  expect(patch).toEqual({state:'archived',notes:'New writing that has not been saved yet.'})
})

test('saving a wheel-selected draft closes the editor after the refreshed item remounts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page)
  let saved = false
  await page.route('**/api/reply-drafts', route => route.fulfill({ json: [{ ...draft, updatedAt: saved ? '2026-11-24' : draft.updatedAt }] }))
  await page.route('**/api/reply-drafts/d1', route => { saved = true; return route.fulfill({ status: 204, body: '' }) })
  const dialog = await openWheel(page, 'parking-lot')
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open Draft', exact: true }).click()
  const card = page.locator('[data-pick-id="d1"]')
  await expect(card.getByLabel('Draft title', { exact: true })).toBeFocused()
  await card.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(card.getByLabel('Draft title', { exact: true })).toHaveCount(0)
  expect(saved).toBe(true)
})

test('single manual scene never invents a Tumblr address', async ({ page }) => {
  await mock(page, [{ ...scene, rootBlogId: 'manual' }])
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await expect(dialog.getByRole('link', { name: 'Open Thread' })).toHaveAttribute('href', '#starter/s1')
  await expect(dialog.getByRole('link', { name: 'Open on Tumblr' })).toHaveCount(0)
})

test('unavailable clipboard leaves a usable native Tumblr link and recovery message', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page)
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await expect(dialog).toContainText('Use the link menu to copy the Tumblr address.')
  await expect(dialog.getByRole('link', { name: 'Open on Tumblr' })).toHaveAttribute('href', 'https://www.tumblr.com/mira/202')
})

for (const width of [320, 375, 430, 768, 1024, 1440, 1920]) {
  test(`layouts and wheel fit ${width}px with long content`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await mock(page, [{ ...scene, title: 'Aurelius-Vermeer-von-Blackwood-III'.repeat(5) }, { ...scene, id: 'b2' }])
    await page.route('**/api/characters', route => route.fulfill({ json: [{ ...characters[0], name: 'Aurelius-Vermeer-von-Blackwood-III'.repeat(3) }] }))
    await page.route('**/api/character-planner', route => route.fulfill({ json: { plans: [{ id: 'p1', name: 'Aurelius-Vermeer-von-Blackwood-III'.repeat(3), state: 'idea', resources: [], notes: 'An idea waiting to find its home.', faceclaim: 'An unusually long faceclaim and concept description for the character planner.' }], hasMore: false, nextCursor: null } }))
    for (const route of ['dashboard', 'characters', 'parking-lot', 'tools', 'planner']) {
      await page.goto('/#' + route)
      await expect(page.locator('main h1').first()).toHaveText({dashboard:'Your turn',characters:'Characters','parking-lot':'Parking Lot',tools:'Writing tools',planner:'Character planner'}[route]!)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    for (const route of ['dashboard', 'parking-lot']) {
      const dialog = await openWheel(page, route)
      await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
      await expect(dialog.locator('.wheel-result h3')).toBeVisible()
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    }
  })
}

test('large wheel keeps its full candidate names readable outside the dial', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page, Array.from({ length: 100 }, (_, i) => ({ ...scene, id: `b${i}`, title: `Scene ${i}` })))
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Scene 75', exact: true })).toBeVisible()
  await dialog.getByText('On the wheel (100)', { exact: true }).click()
  await expect(dialog.locator('li')).toHaveCount(100)
})

test.describe('touchscreen', () => {
test.use({ hasTouch: true, isMobile: true })
test('short touch viewport keeps the result action reachable and Details usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page)
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  const action = dialog.getByRole('link', { name: 'Open on Tumblr' })
  await action.scrollIntoViewIfNeeded()
  const bounds = await action.boundingBox()
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568)
  await page.keyboard.press('Escape')
  await page.locator('[data-pick-id="b1"] .scene-card-hint').tap()
  await expect(page.getByRole('dialog', { name: 'Harbor at dusk' })).toBeVisible()
})
})

test('changing reduced-motion preference settles an active spin immediately', async ({ page }) => {
  await mock(page)
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Spinning…' })).toBeDisabled()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(dialog.getByRole('heading', { name: 'Library heist' })).toBeVisible({ timeout: 1000 })
})

test('dark wheel keeps readable surfaces, result and primary action', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await mock(page)
  const dialog = await openWheel(page)
  await dialog.getByRole('button', { name: 'Spin', exact: true }).click()
  const ratio = await dialog.locator('.wheel-result p').first().evaluate(el => {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
    const luminance = (css: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1)
      const data = ctx.getImageData(0, 0, 1, 1).data
      const rgb = [data[0], data[1], data[2]].map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 })
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
    }
    const foreground = luminance(getComputedStyle(el).color), background = luminance(getComputedStyle(el.parentElement!).backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
  await expect(dialog.getByRole('link', { name: 'Open on Tumblr' })).toBeVisible()
  await page.screenshot({ path: 'test-results/ui-polish/after-dashboard-wheel-dark-1440.png' })
})

test('desktop and mobile screenshots', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page)
  const stage = process.env.UI_CAPTURE_BASELINE ? 'before' : 'after'
  for (const width of [1440, 375]) for (const route of ['dashboard', 'parking-lot']) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto('/#' + route)
    await expect(page.locator('main h1')).toBeVisible()
    await page.screenshot({ path: `test-results/ui-polish/${stage}-${route}-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Spin the wheel' }).click()
    if (!process.env.UI_CAPTURE_BASELINE) await page.getByRole('dialog').getByRole('button', { name: 'Spin', exact: true }).click()
    await page.screenshot({ path: `test-results/ui-polish/${stage}-${route}-wheel-${width}.png` })
    if (!process.env.UI_CAPTURE_BASELINE) await page.keyboard.press('Escape')
  }
})

test('profile uses the shared card editor and exports under the production image policy', async ({ page }) => {
  await mock(page)
  await page.route('**/api/characters', route => route.fulfill({ json: [{ ...characters[0], card: emptyCard(), portraitObjectKey: 'portrait' }] }))
  await page.route('**/api/characters/c1/portrait**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }))
  // Production blocks blob: image URLs. Export must work without widening that policy.
  if (process.env.UI_TEST_DIST) await page.route('http://localhost:5173/', async route => {
    await route.fulfill({ contentType: 'text/html', body: await readFile(resolve(process.env.UI_TEST_DIST!, 'index.html')), headers: { 'Content-Security-Policy': "img-src 'self' data: https://*.tumblr.com" } })
  })
  await page.goto('/#character/c1')
  await page.getByRole('button', { name: 'Edit card', exact: true }).click()
  const editor = page.getByRole('dialog', { name: "Wren's trading card" })
  await expect(editor).toBeVisible()
  await editor.getByRole('tab', { name: 'Playlist & board' }).click()
  await expect(editor.locator('form form')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'View card', exact: true }).click()
  const viewer = page.getByRole('dialog', { name: "Wren's card" })
  const downloaded = page.waitForEvent('download')
  await viewer.getByRole('button', { name: 'Download', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toMatch(/\.png$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto('/#characters')
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  const cardDownload = page.waitForEvent('download')
  await page.locator('.tcard-tile').getByRole('button', { name: /Download/ }).click()
  expect((await cardDownload).suggestedFilename()).toMatch(/\.png$/)
})

test('public profile follows the card palette and fills its media panels', async ({ page }) => {
  const html = renderPage(
    { id: 's', workspaceId: 'w', characterId: 'c', slug: 'preview', style: 'card', showMoodboard: 1, showPlaylist: 1, showStats: 1, indexable: 0, previewObjectKey: null, disabledByModerator: 0, publicProfileJson: '{}', publicProfilePublishedAt: null },
    { name: 'Wren', iconObjectKey: null, portraitObjectKey: null, cardJson: null },
    { ...emptyCard(), theme: 'vamp', nickname: 'Wren Marlowe', boardUrl: 'https://www.pinterest.com/wren/moodboard/', playlistUrl: 'https://open.spotify.com/playlist/1234567890123456789012' },
    { total: 3, mine: 2, theirs: 1, rps: [] }, [], 'http://localhost:5173')
  await page.route('https://**/*', route => route.fulfill({ body: '', contentType: 'text/html' }))
  await page.route('**/share.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve('public/share.js')) }))
  await page.route('**/c/preview', route => route.fulfill({ contentType: 'text/html', body: html, headers: { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://open.spotify.com https://petracoding.github.io" } }))
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/c/preview')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wren Marlowe')
    expect(await page.locator('.hero-name em').evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic')
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--paper').trim())).toBe(THEMES.vamp.bg[1])
    await expect(page.locator('.playlist-embed iframe')).toHaveAttribute('src', /open.spotify.com\/embed/)
    const board = await page.locator('.board-embed').boundingBox()
    const section = await page.locator('.moodboard-section').boundingBox()
    expect(board!.height).toBeGreaterThanOrEqual(580)
    expect(section!.y + section!.height - board!.y - board!.height).toBeLessThan(30)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/ui/public-profile-${width}.png`, fullPage: true })
    const popupReady = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Open PNG preview', exact: true }).click()
    const popup = await popupReady
    await expect(popup.getByRole('img', { name: 'Character card PNG preview' })).toBeVisible()
    expect(await popup.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1320)
    await popup.close()
  }
})

test('your-turn colors follow every selected dashboard palette in both modes', async ({ page }) => {
  await mock(page)
  await page.goto('/#dashboard')
  await expect(page.locator('article.branch-card').first()).toBeVisible()
  for (const mode of ['light', 'dark']) for (const desk of ['meadow', 'tidepool', 'lavender', 'mushroom']) {
    const colors = await page.evaluate(({ mode, desk }) => {
      const root = document.documentElement
      root.dataset.theme = mode; root.dataset.desk = desk
      const style = getComputedStyle(root)
      return { turn: style.getPropertyValue('--turn').trim(), accent: style.getPropertyValue('--accent').trim(), tint: style.getPropertyValue('--turn-t').trim(), highlight: style.getPropertyValue('--highlight').trim() }
    }, { mode, desk })
    expect(colors.turn, `${desk} ${mode}`).toBe(colors.accent)
    expect(colors.tint, `${desk} ${mode}`).toBe(colors.highlight)
  }
})

test('usability walkthrough: all main pages fit desktop and phone with named controls', async ({ page }) => {
  test.setTimeout(120000)
  await mock(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const pages = ['dashboard', 'characters', 'character/c1', 'parking-lot', 'planner', 'activity', 'connections', 'tools', 'tools/focus', 'tools/sprints', 'settings', 'roadmap', 'support', 'terms', 'privacy', 'cookies']
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of pages) {
      await page.goto('/#' + route)
      const names: Record<string, RegExp> = { dashboard: /^Your turn$/, characters: /Characters/, 'character/c1': /^Wren$/, 'parking-lot': /Parking Lot/, planner: /Character planner/, activity: /Tumblr activity/, connections: /Connected accounts/, tools: /Writing tools/, 'tools\/focus': /^Focus$/, 'tools/sprints': /Writing sprints/, settings: /Settings/, roadmap: /Site roadmap/, support: /Support/, terms: /Terms/, privacy: /Privacy/, cookies: /Cookie/ }
      await expect(page.getByRole('heading', { level: 1, name: names[route] }).first(), route).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} at ${width}`).toBe(true)
      const unnamed = await page.getByRole('button', { name: '', exact: true }).evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().width > 0).length)
      expect(unnamed, `${route} unnamed controls`).toBe(0)
      await page.screenshot({ path: `test-results/ui/usability-${route.replaceAll('/', '-')}-${width}.png`, animations: 'disabled' })
    }
  }
})
