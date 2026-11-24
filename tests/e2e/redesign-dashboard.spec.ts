import { expect, test, type Page } from '@playwright/test'

// Redesign phase 2: the scene-details drawer, in-place delete confirmation and label form, and the spinning wheel.
// API mocked; one your-turn scene.
const BRANCH = {
  id: 'b1', starterId: 's1', title: 'Harbor at dusk', characterId: 'c1', characterName: 'Wren', partnerLabel: 'ash.tumblr.com',
  partnerId: null, status: 'your_turn', notes: '', rootPostId: '1', rootBlogId: 'wren.tumblr.com', latestPostId: null, lastPoster: null,
  description: 'Rain on the docks, a lamp left burning.', lastActivityAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  latestReplyExcerpt: 'The ledger had not been opened in nine years.', partnerMuses: [], userRecap: '', nextCheckAt: null,
  groupName: null, archivedAt: null, starterArchived: 0, refreshError: null, iconObjectKey: null,
}

async function signIn(page: Page, deleted: string[]) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.pathname === '/api/starters/s1' && method === 'DELETE') { deleted.push('s1'); return route.fulfill({ status: 204, body: '' }) }
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1' } }
    else if (url.pathname === '/api/inbox') body = { branches: deleted.length ? [] : [BRANCH], yourTurnCount: deleted.length ? 0 : 1, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c1', name: 'Wren' }], partners: [], groups: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ json: body })
  })
  await page.goto('/#dashboard')
}

test('scene details open in a drawer that closes on Escape, asks before deleting, and adds labels in place', async ({ page }) => {
  const deleted: string[] = []
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, deleted)
  await expect(page.getByText('You owe 1 reply. The oldest has waited 3 days.')).toBeVisible({ timeout: 15000 })
  const trigger = page.getByRole('button', { name: /Show scene details/ })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Harbor at dusk' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByLabel('Scene premise')).toHaveValue('Rain on the docks, a lamp left burning.')
  await drawer.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  await page.screenshot({ path: 'test-results/redesign-drawer-1440.png' })

  await drawer.getByRole('button', { name: '+ Add label' }).click()
  await expect(drawer.getByLabel('New label')).toBeFocused()
  await drawer.getByRole('button', { name: 'Cancel' }).click()

  await drawer.getByRole('button', { name: 'Delete thread' }).click()
  await expect(drawer.getByRole('alert')).toContainText('Delete this entire thread')
  await drawer.getByRole('button', { name: 'Keep it' }).click()
  expect(deleted).toEqual([])

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await drawer.getByRole('button', { name: 'Delete thread' }).click()
  await drawer.getByRole('alert').getByRole('button', { name: 'Delete thread' }).click()
  await expect.poll(() => deleted).toEqual(['s1'])
})

test('phone: the drawer fills the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, [])
  await page.getByRole('button', { name: /Show scene details/ }).click()
  const drawer = page.getByRole('dialog', { name: 'Harbor at dusk' })
  await drawer.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  const box = (await drawer.boundingBox())!
  expect(Math.round(box.width)).toBe(390)
  expect(Math.round(box.x)).toBe(0)
  await page.screenshot({ path: 'test-results/redesign-drawer-390.png' })
})

test('Add a thread opens as a dialog from the header link and closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, [])
  await page.getByRole('link', { name: '+ Add a thread' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a thread' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Scene premise')).toHaveValue('')
  await expect(dialog.getByText('Paste a link to see the post here for reference.')).toBeVisible()
  await dialog.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  await page.screenshot({ path: 'test-results/redesign-add-thread-1440.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#dashboard$/)
})

test('Tumblr activity: Add to tracker opens the same full form, prefilled, and sends an empty premise', async ({ page }) => {
  let created: Record<string, unknown> | null = null
  const mention = { id: 'm1', blogIdentifier: 'wren.tumblr.com', actor: 'ash.tumblr.com', timestamp: new Date().toISOString(), postId: '777', preview: 'Who: @wren and @ash. Where: the frost market.', sourceUrl: 'https://www.tumblr.com/ash/777', threadKey: 'ash.tumblr.com:777' }
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.pathname === '/api/starters' && method === 'POST') { created = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { id: 's9' } }) }
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1' } }
    else if (url.pathname === '/api/tumblr-activity') body = { asks: [], mentions: [mention], threadCandidates: [], blogs: [{ blogIdentifier: 'wren.tumblr.com', status: 'ok', error: null, oldestTimestamp: null, exhausted: true }], diagnostics: [] }
    else if (url.pathname === '/api/characters') body = [{ id: 'c1', name: 'Wren' }]
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c1', name: 'Wren' }], partners: [], groups: [] }
    else if (url.pathname === '/api/starters/resolve') body = { suggestedTitle: 'Wren × Ash', preview: 'Who: @wren and @ash. Where: the frost market.', sourceBlogAssigned: true, participants: ['ash.tumblr.com'], suggestedPartner: 'ash.tumblr.com', candidates: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    else if (method !== 'GET') body = {}
    return route.fulfill({ json: body })
  })
  await page.goto('/#activity')
  await page.getByLabel('Track for').selectOption('c1')
  await page.getByRole('button', { name: 'Add to tracker' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a thread' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Post or message link')).toHaveValue('https://www.tumblr.com/ash/777')
  await expect(dialog.getByLabel('Character', { exact: true })).toHaveValue('c1')
  await expect(dialog.getByLabel(/Scene label/)).toHaveValue('Wren × Ash')
  await expect(dialog.getByLabel('Scene premise')).toHaveValue('')
  await dialog.getByText('Show the linked post').click()
  await expect(dialog.locator('.source-preview blockquote')).toContainText('the frost market')
  await dialog.getByRole('button', { name: 'Add thread', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Starter added to your tracker.' })).toBeVisible()
  expect(created).toMatchObject({ characterId: 'c1', postUrl: 'https://www.tumblr.com/ash/777', description: '' })
})

test('owed scenes come first, oldest first, and the Reply run counts queued separately and uses the server total', async ({ page }) => {
  const day = 86_400_000
  const scene = (id: string, title: string, status: string, daysAgo: number, groupName: string | null = null) => ({ ...BRANCH, id, starterId: 's' + id, title, status, groupName, lastActivityAt: new Date(Date.now() - daysAgo * day).toISOString() })
  const branches = [
    scene('1', 'Newer owed', 'your_turn', 1, 'Tortuga Harbor'), scene('2', 'Oldest owed', 'your_turn', 9),
    scene('3', 'Waiting one', 'their_turn', 2), scene('4', 'Waiting two', 'their_turn', 4, 'Tortuga Harbor'), scene('5', 'Ledger of debts', 'queued', 3),
  ]
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1' } }
    // 120 owed in all: the page holds only the first 100 rows, so the count must come from yourTurnCount
    else if (url.pathname === '/api/inbox') body = { branches, yourTurnCount: 120, overdueDraftCount: 0, dueSoonCount: 0, hasMore: true }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c1', name: 'Wren' }], partners: [], groups: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ json: body })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#dashboard')
  const run = page.locator('.reply-run')
  await expect(run).toContainText('120 scenes on your desk')
  await expect(run).toContainText('2+ waiting on a partner')
  await expect(run).toContainText('1+ queued')
  await expect(page.getByText('You owe 120 replies.')).toBeVisible()
  const lane = page.getByRole('region', { name: 'Owed now' })
  const laneTitles = await lane.locator('article.branch-card').evaluateAll(cards => cards.map(card => card.textContent ?? ''))
  expect(laneTitles).toHaveLength(2)
  expect(laneTitles[0]).toContain('Oldest owed')
  expect(laneTitles[1]).toContain('Newer owed')
  // the groups below keep the RP grouping and hold only the rest
  const groups = page.locator('.rp-groups')
  await expect(groups).toContainText('Waiting one')
  await expect(groups).toContainText('Tortuga Harbor')
  await expect(groups).toContainText('Ledger of debts')
  await expect(groups).not.toContainText('Oldest owed')
  await expect(page.getByRole('heading', { level: 2, name: 'Waiting and queued, by RP' })).toBeVisible()
})

test('"I replied" moves a scene to waiting with an undo, and queued scenes offer both turns', async ({ page }) => {
  const branches = [
    { ...BRANCH, id: 'b1', starterId: 's1', title: 'Harbor at dusk', status: 'your_turn' },
    { ...BRANCH, id: 'b2', starterId: 's2', title: 'Ledger of debts', status: 'queued' },
  ]
  const patches: { id: string; status: string }[] = []
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    const patch = url.pathname.match(/^\/api\/branches\/(\w+)$/)
    if (patch && method === 'PATCH') {
      const { status } = route.request().postDataJSON() as { status: string }
      patches.push({ id: patch[1], status })
      branches.find(branch => branch.id === patch[1])!.status = status
      return route.fulfill({ json: {} })
    }
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1' } }
    else if (url.pathname === '/api/inbox') body = { branches, yourTurnCount: branches.filter(b => b.status === 'your_turn').length, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c1', name: 'Wren' }], partners: [], groups: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ json: body })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#dashboard')
  const lane = page.getByRole('region', { name: 'Owed now' })
  await lane.getByRole('button', { name: 'I replied' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Harbor at dusk moved to waiting.' })).toBeVisible()
  await expect(lane).toHaveCount(0) // nothing owed: the lane goes away
  const groups = page.locator('.rp-groups')
  await expect(groups.locator('article', { hasText: 'Harbor at dusk' }).getByRole('button', { name: 'Their reply came in' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('region', { name: 'Owed now' }).getByText('Harbor at dusk')).toBeVisible()
  expect(patches).toEqual([{ id: 'b1', status: 'their_turn' }, { id: 'b1', status: 'your_turn' }])
  // the scene-move transition names are temporary: none may stay on a card (they would clash with page transitions)
  await expect.poll(() => page.locator('article.branch-card').evaluateAll(cards => cards.filter(card => (card as HTMLElement).style.viewTransitionName).length), { timeout: 3000 }).toBe(0)
  const queued = groups.locator('article', { hasText: 'Ledger of debts' })
  await expect(queued.getByRole('button', { name: 'Your turn', exact: true })).toBeVisible()
  await expect(queued.getByRole('button', { name: 'Their turn', exact: true })).toBeVisible()
})

test('desk rail: the focus timer keeps running across pages, music checks the link, quick notes park, and it collapses', async ({ page }) => {
  const posted: unknown[] = []
  await page.route(/open\.spotify\.com/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.pathname === '/api/reply-drafts' && method === 'POST') { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'd1' } }) }
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1' } }
    else if (url.pathname === '/api/inbox') body = { branches: [BRANCH], yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c1', name: 'Wren' }], partners: [], groups: [] }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ json: body })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#dashboard')
  const desk = page.getByRole('complementary', { name: 'Your desk' })
  await desk.getByRole('button', { name: 'Start focus' }).click()
  await expect(desk.getByRole('button', { name: 'Pause focus' })).toBeVisible()
  await page.goto('/#characters')
  await expect(desk.getByRole('timer')).toHaveAttribute('aria-label', /^Writing, 2[45]:\d\d left$/)

  await desk.getByLabel('Playlist link').fill('https://example.com/not-music')
  await desk.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(desk.getByRole('alert')).toHaveText('Paste a Spotify, YouTube or Apple Music link.')
  await desk.getByLabel('Playlist link').fill('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
  await desk.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(desk.locator('iframe')).toHaveCount(0) // click-to-load: nothing from Spotify until asked
  await desk.getByRole('button', { name: 'Load the Spotify player' }).click()
  await expect(desk.locator('iframe')).toHaveAttribute('src', 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M')

  await desk.getByRole('textbox', { name: 'Quick note' }).fill('She keeps the lamp lit for him.')
  await desk.getByRole('button', { name: 'Save to Parking Lot' }).click()
  await expect(desk.getByRole('status')).toHaveText('Saved to your Parking Lot.')
  expect(posted).toEqual([{ title: 'She keeps the lamp lit for him.', notes: 'She keeps the lamp lit for him.', purpose: 'note' }])
  await expect(desk.getByRole('textbox', { name: 'Quick note' })).toHaveValue('')

  await desk.getByRole('button', { name: 'Collapse desk' }).click()
  await page.reload()
  await expect(desk.getByRole('button', { name: 'Expand desk' })).toBeVisible()
  await expect(desk.getByRole('button', { name: /^Open desk\. Focus timer/ })).toBeVisible()

  // phones: no rail, a slim bar while the cycle runs
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(desk).toBeHidden()
  const bar = page.getByRole('region', { name: 'Focus timer' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Pause focus' }).click()
  await expect(bar).toContainText('Paused')
})
