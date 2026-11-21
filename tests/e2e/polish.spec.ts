import { expect, test, type Page } from '@playwright/test'

/**
 * T7c: layout polish — hit areas, tabular numbers, stable images, skeletons vs empty, no horizontal scroll.
 *
 * Viewport: 390×844 iPhone-like (hasTouch) for hit-area and layout checks.
 * The "200% zoom" check uses a 640×400 viewport (simulates zoom by shrinking the CSS viewport).
 */

const user = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
// The inbox summary (Do-next, reminders, reply-run donut) only shows once there is a thread; an empty inbox shows onboarding.
const oneBranch = { id: 'b1', workspaceId: 'w1', starterId: 's1', partnerId: null, status: 'your_turn', notes: '', latestPostId: null, lastPoster: null, lastActivityAt: null, latestReplyExcerpt: null, lastRefreshAt: null, refreshError: null, statusManualOverrideAt: null, archivedAt: null, createdAt: '2026-11-16T00:00:00Z', nextCheckAt: null, title: 'First branch', description: '', characterId: 'c1', characterName: 'Remy', groupId: null, groupName: null, rpUnsortedReason: 'no_rps', iconObjectKey: null, source: 'tumblr', rootPostId: '1', rootBlogId: 'x.tumblr.com', starterArchived: 0, partnerLabel: null }

const baseRoute = (page: Page, overrides: { inbox?: unknown; delayInboxMs?: number }) => {
  const delay = overrides.delayInboxMs ?? 0
  page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = user
    if (url.pathname === '/api/inbox') {
      if (delay) await new Promise(r => setTimeout(r, delay))
      body = overrides.inbox ?? { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    } else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = user
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    else if (url.pathname === '/api/characters') body = []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test.describe('T7c polish', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('hit areas: listed elements are >=44 px tall at 390 px with touch', async ({ page }) => {
    // Inbox with an overdue draft so the "1 overdue note" link is rendered.
    // Also include a character so the Characters page shows "assign Tumblr" and "Add link".
    baseRoute(page, { inbox: { branches: [oneBranch], yourTurnCount: 1, overdueDraftCount: 1, dueSoonCount: 0 } })
    // Override /api/characters and /api/connections to return test data.
    page.route('**/api/characters', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'c1', name: 'Rowan Ash', color: null, state: 'active', notes: null, iconObjectKey: null }]),
    }))
    page.route('**/api/connections', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }))
    page.route('**/api/characters/*/quicklinks', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }))
    await page.goto('/#inbox')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()

    // "1 overdue note" link (.reminder-summary a)
    const overdue = page.locator('.reminder-summary a')
    await expect(overdue).toBeVisible()
    const overdueBox = await overdue.first().boundingBox()
    // 2.75rem = 44px; allow 1px sub-pixel tolerance.
    expect(overdueBox?.height ?? 0).toBeGreaterThanOrEqual(43.5)

    // "Use the Parking Lot for ideas & DMs" (.text-action)
    const parking = page.locator('.inbox-summary a.text-action')
    await expect(parking).toBeVisible()
    const parkingBox = await parking.boundingBox()
    expect(parkingBox?.height ?? 0).toBeGreaterThanOrEqual(43.5)

    // (The "More filters" disclosure was removed from FilterBar; its selects are plain fields now.)

    // .text-button "Add link" and "assign Tumblr" (.field-help a) are on the character list.
    await page.goto('/#characters')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()
    await expect(page.getByText('Rowan Ash')).toBeVisible({ timeout: 3000 })

    // "assign Tumblr" (.field-help a)
    const assignTumblr = page.locator('.field-help a')
    await expect(assignTumblr).toBeVisible()
    const atBox = await assignTumblr.boundingBox()
    expect(atBox?.height ?? 0).toBeGreaterThanOrEqual(43.5)

    // .text-button "Add link" — on the character card
    const addLink = page.getByRole('button', { name: 'Add link' })
    await expect(addLink).toBeVisible()
    const alBox = await addLink.boundingBox()
    expect(alBox?.height ?? 0).toBeGreaterThanOrEqual(43.5)
  })

  test('tabular numbers: count/stat elements have font-variant-numeric: tabular-nums', async ({ page }) => {
    baseRoute(page, { inbox: { branches: [oneBranch], yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0 } })
    await page.goto('/#inbox')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()

    // The reply count now lives once, in the chart card's donut
    const countPill = page.locator('.reply-donut strong').first()
    await expect(countPill).toBeVisible()
    const fv = await countPill.evaluate(el => getComputedStyle(el).fontVariantNumeric)
    expect(fv).toContain('tabular-nums')

    // .do-next button
    const doNext = page.locator('.do-next')
    await expect(doNext).toBeVisible()
    const doNextFv = await doNext.evaluate(el => getComputedStyle(el).fontVariantNumeric)
    expect(doNextFv).toContain('tabular-nums')
  })

  test('skeleton vs empty: delayed inbox shows skeleton, not empty state', async ({ page }) => {
    // Delay all API routes by 1.5 s so the skeleton is visible during the wait.
    page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let body: unknown = user
      if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
      else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
      else if (url.pathname === '/api/tags') body = []
      else if (url.pathname === '/api/rp-groups') body = []
      else if (url.pathname === '/api/settings') body = user
      else if (url.pathname === '/api/push/subscription') body = { enabled: false }
      else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
      await new Promise(r => setTimeout(r, 1500))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('/#inbox')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()

    // Skeleton should be visible while loading
    await expect(page.locator('.skeletons')).toBeVisible({ timeout: 500 })
    // Empty-state text should NOT be visible yet
    await expect(page.locator('.onboarding')).toHaveCount(0, { timeout: 500 })

    // After resolution with no branches, skeleton should be gone
    await expect(page.locator('.skeletons')).toBeHidden({ timeout: 5000 })
    // The inbox renders with an empty branch list; empty-state summary should be visible
    await expect(page.locator('.onboarding')).toBeVisible({ timeout: 5000 })
  })

  test('skeleton vs empty: resolved inbox with no branches shows empty state, no skeleton', async ({ page }) => {
    baseRoute(page, { inbox: { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 } })
    await page.goto('/#inbox')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()

    // Wait for load to finish
    await page.waitForTimeout(300)
    const skeletonCount = await page.locator('.skeletons').count()
    expect(skeletonCount).toBe(0)
    // Empty-state text should be visible
    await expect(page.locator('.onboarding')).toBeVisible()
  })

  test('avatar 404: broken icon shows initials in the same box size', async ({ page }) => {
    // Route the character icon to a 404 so the img triggers onError.
    page.route('**/api/characters/c1/icon**', route => route.fulfill({ status: 404, body: 'not found' }))
    baseRoute(page, { inbox: { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 } })
    // Override /api/characters to return one character with an iconObjectKey.
    page.route('**/api/characters', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'c1', name: 'Rowan Ash', state: 'active', iconObjectKey: 'key1' }]),
    }))
    await page.goto('/#characters')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()

    // Wait for the 404 to trigger the fallback
    const avatar = page.locator('.character-avatar').first()
    await expect(avatar).toBeVisible({ timeout: 5000 })
    await expect(avatar).toHaveClass(/avatar-fallback/, { timeout: 5000 })

    // The box size should match the width/height attributes (44px)
    const box = await avatar.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(30) // 44px CSS, allow for border
    expect(box?.height ?? 0).toBeGreaterThan(30)

    // The ::after pseudo-element shows the initials
    const initials = await avatar.evaluate(el => {
      const after = getComputedStyle(el, '::after')
      return after.content
    })
    expect(initials).toContain('RA') // Rowan Ash → RA
  })

  test('200% zoom: Inbox has no horizontal scroll at 640×400', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 })
    baseRoute(page, { inbox: { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 } })
    await page.goto('/#inbox')
    await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()
    await page.waitForTimeout(300)

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })
})
