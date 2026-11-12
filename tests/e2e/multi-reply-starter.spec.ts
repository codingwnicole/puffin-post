import { expect, test } from '@playwright/test'

test('three participants are actionable independently from inbox and starter detail', async ({ page }) => {
  const starter = { id:'s',title:'Open starter',characterId:'c',description:'Shared scene',rootPostId:'123',rootBlogId:'writer.tumblr.com' }
  const rows = ['One','Two','Three'].map((name,i) => ({ id:`b${i}`,starterId:'s',title:starter.title,characterId:'c',characterName:'Writer',partnerLabel:name,partnerId:null,status:'your_turn',notes:'',rootPostId:'123',rootBlogId:'writer.tumblr.com' }))
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (url.pathname === '/api/inbox') return route.fulfill({ json:{ branches:rows.filter(r => r.status !== 'archived'),yourTurnCount:rows.filter(r => r.status === 'your_turn').length } })
    if (url.pathname === '/api/starters/s') return route.fulfill({ json:{ starter,branches:rows } })
    if (route.request().method() === 'PATCH') {
      const row = rows.find(r => url.pathname.endsWith(r.id))!
      Object.assign(row,route.request().postDataJSON())
      return route.fulfill({ json:row })
    }
    return route.fulfill({ status:404 })
  })
  await page.goto('/')
  await expect(page.getByText('3 replies need you')).toBeVisible()
  const first = page.getByRole('article').filter({ hasText:'One' })
  await first.getByLabel('Status').selectOption('archived')
  await first.getByRole('button',{ name:'Save branch' }).click()
  await expect(page.getByText('2 replies need you')).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.getByRole('link',{ name:'Open starter',exact:true }).first().click()
  await expect(page.getByText('Shared scene')).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(3)
  await expect(page.getByRole('article').filter({ hasText:'One' }).getByLabel('Status')).toHaveValue('archived')
  await expect(page.getByRole('article').filter({ hasText:'Two' }).getByLabel('Status')).toHaveValue('your_turn')
})

test('creates a shared starter and adds a participant without duplicating it', async ({ page }) => {
  let saved: any, added: any
  const rows: any[] = []
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[{ id:'p',name:'Partner' }] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches:[],yourTurnCount:0 } })
    if (path === '/api/starters' && method === 'POST') { saved = route.request().postDataJSON(); return route.fulfill({ status:201,json:{ id:'s',...saved } }) }
    if (path === '/api/starters/s') return route.fulfill({ json:{ starter:{ id:'s',...saved },branches:rows } })
    if (path === '/api/starters/s/branches') {
      added = route.request().postDataJSON()
      rows.push({ id:'b',starterId:'s',...saved,characterName:'Writer',partnerLabel:'Partner',status:'your_turn',...added })
      return route.fulfill({ status:201,json:rows[0] })
    }
    return route.fulfill({ status:404 })
  })
  await page.goto('/')
  await page.getByText('Add Tumblr starter',{ exact:true }).click()
  await page.getByLabel('Starter title').fill('Rooftop scene')
  await page.getByLabel('Character',{ exact:true }).selectOption('c')
  await page.getByLabel('Tumblr blog').fill('writer.tumblr.com')
  await page.getByLabel('Tumblr post ID').fill('123')
  await page.getByLabel('Shared description').fill('Shared by every branch')
  await page.getByRole('button',{ name:'Create starter',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'Rooftop scene',exact:true })).toBeVisible()
  await page.getByLabel('Partner').selectOption('p')
  await page.getByLabel('Branch notes').fill('Only for this participant')
  await page.getByRole('button',{ name:'Add branch',exact:true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByText('Shared by every branch')).toBeVisible()
  expect(added).toEqual({ partnerId:'p',notes:'Only for this participant' })
})

test('direct starter navigation updates the record and participant action target', async ({ page }) => {
  const fetched: string[] = [], targets: string[] = []
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[],partners:[] } })
    const match = /^\/api\/starters\/(one|two)(\/branches)?$/.exec(path)
    if (!match) return route.fulfill({ status:404 })
    if (match[2]) { targets.push(match[1]); return route.fulfill({ status:201,json:{ id:'branch' } }) }
    fetched.push(match[1])
    return route.fulfill({ json:{ starter:{ id:match[1],title:`Starter ${match[1]}`,description:`Scene ${match[1]}`,rootBlogId:'writer.tumblr.com',rootPostId:'123' },branches:[] } })
  })
  await page.goto('/#starter/one')
  await expect(page.getByRole('heading',{ name:'Starter one',exact:true })).toBeVisible()
  await page.evaluate(() => { location.hash = 'starter/two' })
  await expect(page.getByRole('heading',{ name:'Starter two',exact:true })).toBeVisible()
  await expect(page.getByText('Scene two',{ exact:true })).toBeVisible()
  expect(fetched).toContain('two')
  await page.getByLabel('Branch notes').fill('For the second scene')
  await page.getByRole('button',{ name:'Add branch',exact:true }).click()
  await expect.poll(() => targets).toEqual(['two'])
  await expect(page.getByRole('heading',{ name:'Starter one',exact:true })).toHaveCount(0)
})

test('a delayed previous starter response cannot overwrite the current starter', async ({ page }) => {
  let releasePrevious!: () => void
  const previousPending = new Promise<void>(resolve => { releasePrevious = resolve })
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[],partners:[] } })
    const id = path.split('/').at(-1)!
    if (id === 'one') await previousPending
    return route.fulfill({ json:{ starter:{ id,title:`Starter ${id}`,description:`Scene ${id}` },branches:[] } })
  })
  const previousRequest = page.waitForRequest('**/api/starters/one')
  await page.goto('/#starter/one')
  await previousRequest
  await page.evaluate(() => { location.hash = 'starter/two' })
  await expect(page.getByRole('heading',{ name:'Starter two',exact:true })).toBeVisible()
  const oldResponse = page.waitForResponse('**/api/starters/one')
  releasePrevious()
  await (await oldResponse).finished()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.getByRole('heading',{ name:'Starter two',exact:true })).toBeVisible()
  await expect(page.getByText('Scene one',{ exact:true })).toHaveCount(0)
})

test('shows a refresh warning only on the affected branch in inbox and starter detail', async ({ page }) => {
  const starter = { id:'s',title:'Refresh test',characterId:'c',description:'Shared scene',rootPostId:'123',rootBlogId:'writer.tumblr.com' }
  const branches = [
    { id:'affected',starterId:'s',title:starter.title,characterId:'c',characterName:'Writer',partnerLabel:'Friend',partnerId:null,status:'their_turn',notes:'',rootPostId:'123',rootBlogId:'writer.tumblr.com',refreshError:'Tumblr refresh failed (503)' },
    { id:'healthy',starterId:'s',title:starter.title,characterId:'c',characterName:'Writer',partnerLabel:'Other',partnerId:null,status:'their_turn',notes:'',rootPostId:'123',rootBlogId:'writer.tumblr.com',refreshError:null },
  ]
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches,yourTurnCount:0 } })
    if (path === '/api/starters/s') return route.fulfill({ json:{ starter,branches } })
    return route.fulfill({ status:404 })
  })
  await page.goto('/')
  const affected = page.getByRole('article').filter({ hasText:'Friend' })
  const healthy = page.getByRole('article').filter({ hasText:'Other' })
  await expect(affected.getByRole('status')).toHaveText('Refresh needs attention: Tumblr refresh failed (503)')
  await expect(healthy.getByRole('status')).toHaveCount(0)
  await affected.getByRole('link',{ name:'Refresh test',exact:true }).click()
  await expect(page.getByRole('article').filter({ hasText:'Friend' }).getByRole('status')).toHaveText('Refresh needs attention: Tumblr refresh failed (503)')
  await expect(page.getByRole('article').filter({ hasText:'Other' }).getByRole('status')).toHaveCount(0)
})
