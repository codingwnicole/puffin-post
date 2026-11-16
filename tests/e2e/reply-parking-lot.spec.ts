import { expect, test, type Page } from '@playwright/test'

// Signed-in mock: the shell only renders the workspace (and the parking lot page)
// after GET /api/auth/session returns 200. Unmatched /api/** → [] so pages render
// empty lists instead of crashing.
async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname === '/api/auth/session') body = { user: { id: 'u1', name: 'Tester' } }
    else if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [{ id: 'c', name: 'Writer' }], partners: [] }
    else if (url.pathname === '/api/starters/resolve') body = { participants: [], candidates: [], sourceBlogAssigned: true }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

// Every draft the real API returns carries characterIds (the repo maps each row
// through withCharacters). A mock draft without it makes DraftCard throw on
// draft.characterIds.length, so the helper guarantees the field is present.
function withDraftShape(input: Record<string, unknown>): any {
  return { characterIds: [], characterId: null, ...input }
}

test('manually parks a reply, shows overdue source and keeps editable notes during conversion', async ({ page }) => {
  let drafts: any[] = []
  let converted: any
  await mockApi(page)
  // Catch-all so both the bare collection (/api/reply-drafts) and subpaths
  // (/convert, /d) are handled here; non-reply-drafts fall through to mockApi.
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/reply-drafts')) return route.fallback()
    const method = route.request().method()
    if (url.pathname.endsWith('/convert')) {
      converted = route.request().postDataJSON()
      drafts = []
      return route.fulfill({ json: { starter: { id: 'converted' }, branch: { id: 'b' }, draft: { state: 'converted' } } })
    }
    if (url.pathname === '/api/reply-drafts' && method === 'POST') {
      drafts.push(withDraftShape({ id: 'd', state: 'open', ...route.request().postDataJSON() }))
      return route.fulfill({ status: 201, json: drafts[0] })
    }
    if (url.pathname === '/api/reply-drafts') return route.fulfill({ json: drafts })
    return route.fallback()
  })
  await page.goto('/#parking-lot')
  // The park form lives in a collapsed <details>; open it before filling.
  await page.getByText('Save something for later').click()
  await page.getByLabel('Draft title').fill('Owed DM')
  await page.getByLabel('Draft notes').fill('Remember the rooftop scene')
  await page.getByLabel('Source URL').fill('https://discord.com/channels/@me/123')
  await page.getByLabel('Reminder date').fill('2020-01-01')
  await page.getByRole('button',{ name:'Park reply' }).click()
  const draft = page.getByRole('article')
  await expect(draft).toContainText('Overdue')
  await expect(draft.getByRole('link',{ name:'Open source' })).toHaveAttribute('href','https://discord.com/channels/@me/123')
  await draft.getByRole('button',{ name:'Convert to Tumblr' }).click()
  await expect(draft.getByLabel('Branch notes')).toHaveValue('Remember the rooftop scene')
  await draft.getByLabel('Character',{ exact:true }).selectOption('c')
  // The conversion form uses the shared StarterFields "Post or message link" input.
  await draft.getByLabel('Post or message link').fill('https://writer.tumblr.com/post/12345')
  await draft.getByRole('button', { name: 'Create starter and branch' }).click()
  await expect(page.getByText('Reply converted.')).toBeVisible()
  expect(converted.branch.notes).toBe('Remember the rooftop scene')
  // The client posts the raw URL; the API route derives rootPostId from it.
  expect(converted.starter.postUrl).toBe('https://writer.tumblr.com/post/12345')
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.setViewportSize({ width:390,height:844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('edits notes and archives an open draft', async ({ page }) => {
  let drafts: any[] = [withDraftShape({ id:'d',title:'Waiting reply',notes:'Original',state:'open',reminderAt:null,sourceUrl:null })]
  await mockApi(page)
  // Catch-all so both the bare collection and the /d subpath are handled here;
  // non-reply-drafts fall through to mockApi.
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/reply-drafts')) return route.fallback()
    if (url.pathname === '/api/reply-drafts/d') {
      Object.assign(drafts[0],route.request().postDataJSON())
      const draft = drafts[0]
      if (draft.state === 'archived') drafts = []
      return route.fulfill({ json:draft })
    }
    if (url.pathname === '/api/reply-drafts') return route.fulfill({ json:drafts })
    return route.fallback()
  })
  await page.goto('/#parking-lot')
  const card = page.getByRole('article')
  await card.getByRole('button',{ name:'Edit draft' }).click()
  // The edit form's notes field is the card's only textarea; target it directly
  // (the label's for/id collides with the page-level park form's field).
  await card.locator('textarea').fill('Revised scene notes')
  await card.getByRole('button',{ name:'Save draft' }).click()
  await expect(card.getByText('Revised scene notes',{ exact:true })).toBeVisible()
  await card.getByRole('button',{ name:'Archive draft' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
})
