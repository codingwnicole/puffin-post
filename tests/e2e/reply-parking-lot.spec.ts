import { expect, test } from '@playwright/test'

test('manually parks a reply, shows overdue source and keeps editable notes during conversion', async ({ page }) => {
  let drafts: any[] = []
  let converted: any
  await page.route('**/api/**',async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    if (url.pathname === '/api/inbox') return route.fulfill({ json:{ branches:[],yourTurnCount:0 } })
    if (url.pathname === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (url.pathname.endsWith('/convert')) {
      converted = route.request().postDataJSON()
      drafts = []
      return route.fulfill({ json:{ starter:{ id:'converted' },branch:{ id:'b' },draft:{ state:'converted' } } })
    }
    if (url.pathname === '/api/reply-drafts' && method === 'POST') {
      drafts.push({ id:'d',state:'open',...route.request().postDataJSON() })
      return route.fulfill({ status:201,json:drafts[0] })
    }
    if (url.pathname === '/api/reply-drafts') return route.fulfill({ json:drafts })
    return route.fulfill({ status:404 })
  })
  await page.goto('/#parking-lot')
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
  await draft.getByLabel('Tumblr blog').fill('writer.tumblr.com')
  await draft.getByLabel('Tumblr post ID').fill('12345')
  await draft.getByRole('button',{ name:'Create starter and branch' }).click()
  await expect(page.getByText('Reply converted.')).toBeVisible()
  expect(converted.branch.notes).toBe('Remember the rooftop scene')
  expect(converted.starter.rootPostId).toBe('12345')
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.setViewportSize({ width:390,height:844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('edits notes and archives an open draft', async ({ page }) => {
  let drafts: any[] = [{ id:'d',title:'Waiting reply',notes:'Original',state:'open',reminderAt:null,sourceUrl:null }]
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[],partners:[] } })
    if (path === '/api/reply-drafts/d') {
      Object.assign(drafts[0],route.request().postDataJSON())
      const draft = drafts[0]
      if (draft.state === 'archived') drafts = []
      return route.fulfill({ json:draft })
    }
    if (path === '/api/reply-drafts') return route.fulfill({ json:drafts })
    return route.fulfill({ status:404 })
  })
  await page.goto('/#parking-lot')
  const card = page.getByRole('article')
  await card.getByRole('button',{ name:'Edit draft' }).click()
  await card.getByLabel('Draft notes').fill('Revised scene notes')
  await card.getByRole('button',{ name:'Save draft' }).click()
  await expect(card.getByText('Revised scene notes',{ exact:true })).toBeVisible()
  await card.getByRole('button',{ name:'Archive draft' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
})
