import { expect, test, type Page } from '@playwright/test'

const branch = { id:'b1',starterId:'s',title:'Rain on the docks',characterId:'c',characterName:'Writer',partnerLabel:'Friend',partnerId:null,status:'your_turn',notes:'',
  rootPostId:'111',rootBlogId:'writer.tumblr.com',latestPostId:null,lastPoster:null,starterArchived:0,archivedAt:null,refreshError:null }

async function mockInbox(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json:{ user:{ id:'u1',name:'Tester' } } })
    if (path === '/api/tumblr-activity/unread-count') return route.fulfill({ json:{ count:0 } })
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches:[branch],yourTurnCount:1,overdueDraftCount:0,dueSoonCount:0 } })
    return route.fulfill({ json:[] })
  })
}

test('filters start collapsed, Clear filters wipes every filter in one click, and the panel opens when a filter is on', async ({ page }) => {
  await mockInbox(page)
  await page.goto('/#inbox')
  const summary = page.locator('.filter-panel summary')
  const show = page.getByRole('combobox', { name:'Show', exact:true })
  const clear = page.getByRole('button', { name:'Clear filters' })
  await expect(summary).toHaveText('Show filters')
  await expect(show).toBeHidden()
  await expect(clear).toHaveCount(0)

  await summary.click()
  await show.selectOption('your_turn')
  await page.getByRole('combobox', { name:'Order', exact:true }).selectOption('oldest')
  await page.getByPlaceholder('Scene, character, partner').fill('docks')
  await expect(summary).toHaveText('Hide filters · 3 on')
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('status=your_turn')

  await summary.click() // collapsed with filters on: Clear is still one click away
  await expect(summary).toHaveText('Show filters · 3 on')
  await clear.click()
  await expect(summary).toHaveText('Show filters')
  await expect(clear).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard')
  await summary.click()
  await expect(show).toHaveValue('')
  await expect(page.getByPlaceholder('Scene, character, partner')).toHaveValue('')

  // A filtered address opens the panel so results are never filtered out of sight.
  await page.evaluate(() => localStorage.setItem('rptb-inbox-filters-open', 'closed'))
  await page.goto('/#inbox?status=their_turn'); await page.reload()
  await expect(summary).toHaveText('Hide filters · 1 on')
  await expect(show).toBeVisible()
})

test('the filter panel remembers being left open', async ({ page }) => {
  await mockInbox(page)
  await page.goto('/#inbox')
  await page.locator('.filter-panel summary').click()
  await expect(page.getByRole('combobox', { name:'Show', exact:true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name:'Show', exact:true })).toBeVisible()
})
