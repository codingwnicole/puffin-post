import { test, expect, type Page } from '@playwright/test'

// T7d: view transitions (shared card identities), safe prefetch, and swipe-to-close
// bottom sheets. Same signed-in mock approach as the other e2e specs — the shell only
// renders pages after GET /api/auth/session returns 200.

const OPTIONS = { characters: [{ id: 'char-1', name: 'Juniper' }], partners: [], groups: [] }

const CHARACTERS: unknown[] = [{ id: 'char-1', name: 'Juniper', color: null, state: 'active', notes: null, iconObjectKey: null }]
const ARCHIVED: unknown[] = [{ id: 'char-1', name: 'Juniper', color: null, notes: null, iconObjectKey: null, createdAt: '2026-11-01T00:00:00.000Z', rpGroupNames: [], threadCount: 2 }]

const BRANCH = {
  id: 'branch-1', starterId: 'starter-1', characterId: 'char-1', characterName: 'Juniper',
  status: 'your_turn', title: 'The Long Scene', description: '', notes: '', rpUnsortedReason: 'no_rps',
  partnerId: 'partner-1', partnerLabel: null, iconObjectKey: null,
  rootBlogId: 'test.tumblr.com', rootPostId: null, latestPostId: null, latestReplyExcerpt: null,
  refreshError: null, starterArchived: false,
  lastActivityAt: '2026-11-16T12:00:00.000Z', nextCheckAt: null,
}

const starterDetail = (starterId: string, title: string) => ({
  starter: {
    id: starterId, workspaceId: 'ws-1', characterId: 'char-1', groupId: null, title,
    source: 'tumblr', rootPostId: '1000', rootBlogId: 'writer.tumblr.com',
    threadRootId: '1000', threadRootBlogId: 'writer.tumblr.com',
    postUrl: 'https://writer.tumblr.com/post/1000', description: '', createdAt: '2026-11-01T00:00:00.000Z',
    premise: '', archived: 0, archivedAt: null,
  },
  branches: [BRANCH],
})

// Correct response shapes for every path the shell + pages touch.
// `counts` records how often a tracked path is hit so prefetch assertions are exact.
async function signedIn(page: Page, counts: Record<string, () => void> = {}) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    counts[path]?.()
    const json = path === '/api/auth/session' ? { user: { id: 'u1', name: 'Tester' } }
      : path === '/api/starters/options' ? OPTIONS
      : path === '/api/tumblr-activity/unread-count' ? { count: 0 }
      : path === '/api/characters' ? CHARACTERS
      : path === '/api/characters/archived' ? ARCHIVED
      : path === '/api/characters/char-1/quicklinks' ? []
      : path === '/api/tags' ? []
      : path === '/api/rp-groups' ? []
      : path === '/api/connections' ? []
      : path.startsWith('/api/inbox') ? { branches: [BRANCH], yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0 }
      : path === '/api/starters/starter-1' || path === '/api/starters/branch-1' ? starterDetail(path.slice('/api/starters/'.length), 'The Long Scene')
      : path === '/api/support' ? { items: [], canManage: false }
      : path === '/api/settings' ? {}
      : path === '/api/reply-drafts' ? []
      : path === '/api/characters/char-1/branches' ? [BRANCH]
      : path.startsWith('/api/characters/char-1') ? CHARACTERS[0]
      : []
    return route.fulfill({ json })
  })
}

// A minimal signed-in mock for pages that don't need the full shape set.
async function lightSignedIn(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/auth/session' ? { user: { id: 'u1', name: 'Tester' } }
      : path === '/api/starters/options' ? OPTIONS
      : path === '/api/tumblr-activity/unread-count' ? { count: 0 }
      : path === '/api/characters' ? CHARACTERS
      : path === '/api/characters/archived' ? ARCHIVED
      : path === '/api/tags' ? []
      : path === '/api/rp-groups' ? []
      : path === '/api/connections' ? []
      : path.startsWith('/api/inbox') ? { branches: [BRANCH], yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0 }
      : path === '/api/support' ? { items: [], canManage: false }
      : path === '/api/settings' ? {}
      : path === '/api/reply-drafts' ? []
      : path === '/api/characters/char-1/quicklinks' ? []
      : path.startsWith('/api/characters/char-1') ? CHARACTERS[0]
      : path.startsWith('/api/characters/') ? CHARACTERS[0]
      : []
    return route.fulfill({ json })
  })
}

// View-transition names currently in the DOM, filtered by prefix.
const vtNames = (page: Page, prefix: string) => page.evaluate((p) =>
  Array.from(document.querySelectorAll('[style*="view-transition-name"]'))
    .map(el => (el as HTMLElement).style.viewTransitionName)
    .filter(name => name?.startsWith(p)), prefix)

test.describe('T7d view transitions', () => {
  test('clicking a character card leaves no duplicate identity on either page', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    await signedIn(page)
    await page.goto('/#characters', { waitUntil: 'networkidle' })
    await expect(page.locator('.character-card-top-link')).toBeVisible()
    if (errors.length) console.log('PAGEERRORS:', errors.join(' | '))

    // List page: exactly one element carries the character identity.
    expect(await vtNames(page, 'character-')).toEqual(['character-char-1'])

    // Navigate by clicking the card; the shortcut header carries the SAME single name.
    await page.locator('.character-card-top-link').first().click()
    await expect(page.locator('.shortcut-header')).toBeVisible()
    expect(await vtNames(page, 'character-')).toEqual(['character-char-1'])
  })

  test('branch title -> starter page keeps one identity on the starter page', async ({ page }) => {
    await signedIn(page)
    await page.goto('/#inbox', { waitUntil: 'networkidle' })
    await expect(page.locator('.branch-title-link', { hasText: 'The Long Scene' })).toBeVisible()

    // Click the branch title; the starter page header carries the starter identity.
    await page.locator('.branch-title-link', { hasText: 'The Long Scene' }).click()
    await expect(page.locator('#starter-title')).toBeVisible()
    expect(await vtNames(page, 'starter-')).toEqual(['starter-branch-1'])
  })
})

test.describe('T7d safe prefetch', () => {
  test('hovering the Characters nav link fires exactly one /api/characters, no Tumblr', async ({ page }) => {
    let charHits = 0
    const seen: string[] = []
    await signedIn(page, { '/api/characters': () => { charHits++ } })
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      seen.push(path)
      return route.fallback()
    })

    await page.goto('/#support', { waitUntil: 'networkidle' })
    const nav = page.locator('.primary-nav a[href="#characters"]')
    await expect(nav).toBeVisible()

    const before = charHits
    await nav.hover()
    await page.waitForTimeout(300)

    // Exactly one GET /api/characters from the hover (the /support load never hit it).
    expect(charHits).toBe(before + 1)
    // No Tumblr *refresh* or refresh endpoint was touched by the prefetch.
    // (The periodic unread-count poll is AppShell housekeeping, not the prefetch.)
    expect(seen.filter(p => p.includes('refresh') || p.includes('tumblr-refresh'))).toHaveLength(0)
  })

  test('a second hover within 30s does not refetch', async ({ page }) => {
    let charHits = 0
    // Single route handler that both counts and fulfils — no double counting.
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/characters') charHits++
      const json = path === '/api/auth/session' ? { user: { id: 'u1', name: 'Tester' } }
        : path === '/api/starters/options' ? OPTIONS
        : path === '/api/tumblr-activity/unread-count' ? { count: 0 }
        : path === '/api/characters' ? CHARACTERS
        : path === '/api/support' ? { items: [], canManage: false }
        : path === '/api/settings' ? {}
        : []
      return route.fulfill({ json })
    })
    await page.goto('/#support', { waitUntil: 'networkidle' })
    const nav = page.locator('.primary-nav a[href="#characters"]')
    await expect(nav).toBeVisible()
    const before = charHits
    await nav.hover()
    await nav.hover()
    await page.waitForTimeout(300)
    expect(charHits).toBe(before + 1) // throttled: one fetch, not two
  })
})

test.describe('T7d swipe-to-close sheet', () => {
  async function openSheet(page: Page) {
    await lightSignedIn(page)
    await page.goto('/#support', { waitUntil: 'networkidle' })
    const summary = page.locator('.mobile-more summary')
    await expect(summary).toBeVisible()
    await summary.click()
    await expect(page.locator('.mobile-more-menu')).toBeVisible()
  }

  async function dragGrabber(page: Page, delta: number) {
    const grabber = page.locator('.sheet-grabber')
    const box = await grabber.boundingBox()
    if (!box) throw new Error('grabber not found')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(40)
    const steps = 14
    for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + (delta * i) / steps, { steps: 2 })
    await page.waitForTimeout(40)
    await page.mouse.up()
    await page.waitForTimeout(200)
  }

  test('10% snaps back, 60% closes, Close works, unsaved text blocks close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await openSheet(page)
    const menu = page.locator('.mobile-more-menu')
    const height = (await menu.boundingBox())!.height
    expect(height).toBeGreaterThan(0)

    // 10% drag: snaps back, sheet stays open with no residual transform.
    await dragGrabber(page, height * 0.10)
    await expect(menu).toBeVisible()
    await expect(menu).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 30)')

    // The always-visible Close button dismisses the sheet.
    await page.locator('.sheet-close').click()
    await expect(menu).not.toBeVisible()

    // Reopen; 60% drag closes the sheet.
    await page.locator('.mobile-more summary').click()
    await expect(menu).toBeVisible()
    await dragGrabber(page, height * 0.60)
    await expect(menu).not.toBeVisible()

    // Reopen; type into the sheet's note field, then drag past 30%.
    await page.locator('.mobile-more summary').click()
    await expect(menu).toBeVisible()
    const note = page.locator('.mobile-more-menu .sheet-note')
    await expect(note).toBeVisible()
    await note.fill('unsent draft')
    await dragGrabber(page, height * 0.60)
    // The sheet did NOT close; a status notice explains why.
    await expect(menu).toBeVisible()
    await expect(page.locator('.sheet-notice')).toHaveText('You have unsaved text')
  })
})
