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
    else if (path === '/api/inbox') body = { branches, yourTurnCount: branches.filter(row => row.status === 'your_turn').length, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (path === '/api/starters/options') body = { characters, partners: [], groups: [] }
    else if (path === '/api/characters') body = characters
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
