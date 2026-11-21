import { expect, test, type Page } from '@playwright/test'

// Signed-in shell with a deterministic Inbox: one RP group, one character, one branch
// (your turn) so a single .branch-card exists and the list has a first render to stagger.
const inbox = {
  branches: [{
    id: 'b1', characterId: 'c1', characterName: 'Rowan', characterTag: '#rowan',
    partnerName: 'Partner', starterId: 's1', starterTitle: 'The lighthouse debt',
    status: 'your_turn', statusLabel: 'your turn', groupKey: null, groupName: 'Unsorted',
    rpGroupKey: null, rpUnsortedReason: 'no_group', blogIdentifier: 'rowan.tumblr.com',
    draftBody: '', draftUpdatedAt: null, dueAt: null, dueLabel: null,
    lastPostAt: '2026-11-01T00:00:00.000Z',
  }],
  yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0,
}

async function signedIn(page: Page, branches: unknown[] = inbox.branches) {
  page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { ...inbox, branches }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/#inbox')
  await expect(page.getByRole('link', { name: 'RP Thread Buddy', exact: true })).toBeVisible()
}

test('More filters panel enters from its trigger with a real transition', async ({ page }) => {
  await signedIn(page)
  const trigger = page.locator('.filter-more summary')
  await trigger.click()
  await expect(page.locator('.filter-more')).toHaveAttribute('open', '')

  const panel = await page.locator('.filter-more-grid').evaluate(el => {
    const cs = getComputedStyle(el)
    return { origin: cs.transformOrigin, duration: cs.transitionDuration }
  })
  // Top-left corner (the trigger side), not the 50% 50% default.
  expect(panel.origin).toBe('0px 0px')
  const durations = panel.duration.split(',').map(part => parseFloat(part.trim()) * 1000)
  expect(durations.every(d => d > 0)).toBe(true)
})

test('reduced motion: no transforms and short (<=100ms) fades on panel and branch card', async ({ page }) => {
  await signedIn(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await page.locator('.filter-more summary').click()
  const panel = await page.locator('.filter-more-grid').evaluate(el => {
    const cs = getComputedStyle(el)
    return { transform: cs.transform, transition: cs.transitionDuration, animation: cs.animationDuration }
  })
  expect(panel.transform).toBe('none')
  const panelMs = Math.max(...panel.transition.split(',').map(part => parseFloat(part.trim()) * 1000))
  expect(panelMs).toBeLessThanOrEqual(0.1)

  const card = await page.locator('.branch-card').first().evaluate(el => {
    const cs = getComputedStyle(el)
    return { transform: cs.transform, transition: cs.transitionDuration, animation: cs.animationDuration }
  })
  expect(card.transform).toBe('none')
  const cardMs = Math.max(
    ...[card.transition, card.animation].map(v => v.split(',')).flat()
      .map(part => parseFloat(part.trim()) * 1000).filter(n => !Number.isNaN(n)),
  )
  expect(cardMs).toBeLessThanOrEqual(0.1)
})

test('pressing a button scales it to .97 while held', async ({ page }) => {
  await signedIn(page)
  const button = page.getByRole('button', { name: 'Oldest owed first' })
  await button.hover()
  const box = await button.boundingBox()
  if (!box) throw new Error('Oldest owed first button not found')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Wait past the 150ms press transition so the held state reaches its end value.
  await page.waitForTimeout(300)
  const transform = await button.evaluate(el => getComputedStyle(el).transform)
  expect(transform).toBe('matrix(0.97, 0, 0, 0.97, 0, 0)')
  await page.mouse.up()
})

test('an Inbox data refresh does not re-run the stagger', async ({ page }) => {
  await signedIn(page)
  // First render completes, then the page marks the list as entered.
  await expect(page.locator('.rp-groups')).toHaveAttribute('data-entered', '')
  const card = page.locator('.branch-card').first()
  expect(await card.evaluate(el => getComputedStyle(el).animationName)).toBe('none')

  // A data refresh re-renders the cards but never replays `rise`.
  await page.reload()
  await expect(page.locator('.rp-groups')).toHaveAttribute('data-entered', '')
  expect(await page.locator('.branch-card').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none')

  // Force a fresh stagger (remove the marker), then a data-driven re-render must not
  // replay the animation: the rows settle and stay settled.
  await page.evaluate(() => document.querySelector('.rp-groups')?.removeAttribute('data-entered'))
  await page.reload()
  await expect(page.locator('.branch-card').first()).toBeVisible()
  await page.waitForTimeout(1000) // let any (re)run finish and settle
  expect(await page.locator('.rp-groups')).toHaveAttribute('data-entered', '')
  expect(await page.locator('.branch-card').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none')
})
