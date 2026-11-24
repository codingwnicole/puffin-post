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
  await expect(drawer.getByLabel('Stable premise')).toHaveValue('Rain on the docks, a lamp left burning.')
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
