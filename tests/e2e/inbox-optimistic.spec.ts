import { test, expect, type Page } from '@playwright/test'

// T3/T4/T5 for the unattended Stage-1 brief:
//  - T3 optimistic removal: starter archive/restore flips immediately, revalidates,
//    rolls back + alerts on failure.
//  - T4 stale-while-revalidate: a failed inbox reload keeps the old rows and surfaces a
//    role="alert" (no blank page).
//  - T5 Back navigation: inbox filters mirror into the hash query (shareable, no
//    history entry per keystroke) and a deep-linked filter is restored on load.
//
// Same signed-in mock approach as the other e2e specs: the shell only renders pages
// after GET /api/auth/session returns 200. The base mock handles session/options and
// falls back for everything else; each test registers its own **/api/** route (tried
// first) and calls route.fallback() for the rest.

const OPTIONS = { characters: [{ id: 'char-1', name: 'Juniper' }], partners: [], groups: [] }

const starterDetail = (starterId: string, title: string, archived: number) => ({
  starter: {
    id: starterId, workspaceId: 'ws-1', characterId: 'char-1', groupId: null, title,
    source: 'tumblr', rootPostId: '1000', rootBlogId: 'writer.tumblr.com',
    threadRootId: '1000', threadRootBlogId: 'writer.tumblr.com',
    postUrl: 'https://writer.tumblr.com/post/1000', description: '', createdAt: '2026-11-01T00:00:00.000Z',
    premise: '', archived, archivedAt: null,
  },
  branches: [],
})

// Signed-in base mock: session + options resolve, everything else falls back to [].
async function signedIn(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/auth/session' ? { user: { id: 'u1', name: 'Tester' } }
      : path === '/api/starters/options' ? OPTIONS
      : path === '/api/tumblr-activity/unread-count' ? { count: 0 }
      : []
    return route.fulfill({ json })
  })
}

// A full InboxBranch (src/db/repositories/branches.ts) so BranchRow renders without
// throwing on missing fields.
const inboxWith = (titles: string[]) => ({
  branches: titles.map((title, index) => ({
    id: `branch-${index + 1}`,
    starterId: `starter-${index + 1}`,
    characterId: 'char-1',
    characterName: 'Juniper',
    status: 'your_turn',
    title,
    description: '',
    notes: '',
    rpUnsortedReason: 'no_rps',
    partnerId: 'partner-1',
    partnerLabel: null,
    iconObjectKey: null,
    lastActivityAt: '2026-11-16T12:00:00.000Z',
    nextCheckAt: null,
  })),
  yourTurnCount: titles.length,
  overdueDraftCount: 0,
  dueSoonCount: 0,
})

test.describe('inbox stale-while-revalidate (T4)', () => {
  test('a failed in-flight refresh keeps the loaded rows and shows a role="alert"', async ({ page }) => {
    let failInbox = false
    let inboxHits = 0
    await signedIn(page)
    // Register first so it is tried before the signedIn base mock. The query is
    // always appended (size>=1 via doNext), so /api/inbox always carries ?...
    await page.route('**/api/inbox**', route => {
      inboxHits++
      if (failInbox) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'refresh failed' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inboxWith(['The Long Scene', 'A Second Scene'])) })
    })

    await page.goto('/#/inbox')
    // The branch title renders inside the collapsed row (strong.branch-title); wait
    // for the first render.
    await expect(page.locator('.branch-title strong', { hasText: 'The Long Scene' })).toBeVisible()
    const firstRenderHits = inboxHits

    // Stale-while-revalidate contract: a FAILED background refresh (no fresh data to
    // swap in) keeps the already-loaded content and only surfaces the error — it never
    // blanks the rows. Trigger a refresh by toggling a filter back to its default.
    failInbox = true
    const show = page.locator('.filter-bar select').first()
    await show.selectOption('your_turn')
    await show.selectOption('')

    // Content is kept (not blanked) and the failure is surfaced as an alert.
    await expect(page.getByRole('alert').filter({ hasText: 'refresh failed' })).toBeVisible()
    await expect(page.locator('.branch-title strong', { hasText: 'The Long Scene' })).toBeVisible()
    await expect(page.locator('.branch-title strong', { hasText: 'A Second Scene' })).toBeVisible()
    // A refresh actually fired (proves this is a real revalidation, not the first load).
    expect(inboxHits).toBeGreaterThan(firstRenderHits)
  })
})

test.describe('inbox filter mirroring (T5)', () => {
  test('typing a search mirror-writes the hash query (replaceState, no nav)', async ({ page }) => {
    await signedIn(page)
    await page.route('**/api/inbox**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inboxWith(['A Scene'])) }))

    await page.goto('/#/inbox')
    const search = page.locator('.filter-bar input[placeholder="Scene, character, partner"]')
    await expect(search).toBeVisible()

    const historyLengthBefore = await page.evaluate(() => window.history.length)
    await search.fill('moonlight')

    // The filter is mirrored into the hash query so the view is shareable and a
    // later Reload/Back lands on the same view.
    await page.waitForFunction(() => window.location.hash.includes('q='))
    const hash = await page.evaluate(() => window.location.hash)
    expect(hash).toContain('q=moonlight')
    // replaceState must not add a history entry per keystroke.
    expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBefore)
  })

  test('a deep-linked filter is restored on load', async ({ page }) => {
    await signedIn(page)
    let lastInboxUrl = ''
    await page.route('**/api/inbox**', route => { lastInboxUrl = route.request().url(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inboxWith([])) }) })

    // Deep link a status filter straight in.
    await page.goto('/#/inbox?status=your_turn')
    // The Show select reflects the deep-linked status filter.
    await expect(page.locator('.filter-bar select').first()).toHaveValue('your_turn')
    // The fresh fetch used the mirrored filter (wait for it to actually fire).
    await page.waitForFunction((url: string) => url.includes('status=your_turn'), lastInboxUrl)
  })
})

test.describe('starter archive optimistic removal (T3)', () => {
  test('archive flips the button immediately, revalidates, and rolls back + alerts on failure', async ({ page }) => {
    const starterId = 'arc'
    let archiveShouldFail = false
    // State the reload revalidates against: flips with the optimistic update so the
    // revalidate confirms (does not undo) the first archive.
    let starterArchived = 0
    await signedIn(page)
    // Detail + its archive/restore live under /api/starters/arc. Register first so
    // they are tried before the signedIn base mock.
    await page.route('**/api/starters/arc**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/starters/arc') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(starterDetail(starterId, 'Archivable Thread', starterArchived)) })
      }
      if (path === '/api/starters/arc/archive') {
        if (archiveShouldFail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'archive failed' }) })
        starterArchived = 1
        return route.fulfill({ status: 204 })
      }
      if (path === '/api/starters/arc/restore') {
        if (archiveShouldFail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'archive failed' }) })
        starterArchived = 0
        return route.fulfill({ status: 204 })
      }
      return route.fallback()
    })

    // Starter detail route is /#starter/:id (no leading slash) — pageForRoute matches
    // the bare hash segment.
    await page.goto(`/#starter/${starterId}`)
    const button = page.getByRole('button', { name: 'Archive thread' })
    await expect(button).toBeVisible()

    // First attempt succeeds: the button flips to Restore immediately (optimistic)
    // and the toast appears.
    archiveShouldFail = false
    await button.click()
    await expect(page.getByRole('button', { name: 'Restore thread' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Archived “Archivable Thread”' })).toBeVisible()

    // Second attempt (Restore) fails: the optimistic flip to "Archive thread" happens
    // first, then it rolls back and surfaces a role="alert". Pre-click state was
    // archived, so the rolled-back (restored) state shows "Restore thread".
    archiveShouldFail = true
    await page.getByRole('button', { name: 'Restore thread' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'archive failed' })).toBeVisible()
    // Rolled back to the pre-click (archived) state.
    await expect(page.getByRole('button', { name: 'Restore thread' })).toBeVisible()
  })
})
