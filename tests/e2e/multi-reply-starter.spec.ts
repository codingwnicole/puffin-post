import { expect, test, type Page } from '@playwright/test'

// Signed-in base mock: the shell renders pages only after /api/auth/session is 200.
// Unmatched /api/** returns [] so side fetches (tags, etc.) render empty lists.
// Each test registers its own route afterwards; Playwright tries the newest route
// first, and that route calls route.fallback() for anything it does not handle.
async function signedIn(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/auth/session' ? { user: { id: 'u1', name: 'Tester' } }
      : path === '/api/tumblr-activity/unread-count' ? { count: 0 }
      : []
    return route.fulfill({ json })
  })
}

// Branch cards are collapsed by default; the trigger button expands one.
const card = (page: Page, partner: string) => page.locator('article.branch-card').filter({ has: page.locator('.branch-meta', { hasText: partner }) })
const expand = (page: Page, partner: string) => card(page, partner).locator('.scene-card-trigger').click()

test('three participants are actionable independently from inbox and starter detail', async ({ page }) => {
  const starter = { id:'s',title:'Open starter',characterId:'c',description:'Shared scene',rootPostId:'123',rootBlogId:'writer.tumblr.com' }
  const rows = ['One','Two','Three'].map((name,i) => ({ id:`b${i}`,starterId:'s',title:starter.title,characterId:'c',characterName:'Writer',partnerLabel:name,partnerId:null,status:'your_turn',notes:'',rootPostId:'123',rootBlogId:'writer.tumblr.com' }))
  const patched: string[] = []
  await signedIn(page)
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches:rows.filter(r => r.status !== 'archived'),yourTurnCount:rows.filter(r => r.status === 'your_turn').length,overdueDraftCount:0,dueSoonCount:0 } })
    if (path === '/api/starters/s' && method === 'PATCH') return route.fulfill({ json:starter })
    if (path === '/api/starters/s') return route.fulfill({ json:{ starter,branches:rows } })
    if (path.startsWith('/api/branches/') && method === 'PATCH') {
      const row = rows.find(r => path === `/api/branches/${r.id}`)!
      patched.push(row.id)
      Object.assign(row,route.request().postDataJSON())
      return route.fulfill({ json:row })
    }
    return route.fallback()
  })
  await page.goto('/')
  await expect(page.getByRole('heading',{ name:/Your turn/ })).toBeVisible()
  await expect(page.locator('article.branch-card')).toHaveCount(3)
  // Archive only the first participant; the editor autosaves when focus leaves it.
  await expand(page,'One')
  const status = card(page,'One').getByLabel('Status')
  await status.focus()
  await status.selectOption('archived')
  await status.blur()
  await expect(page.locator('.reply-donut strong')).toHaveText('2')
  await expect(page.locator('article.branch-card')).toHaveCount(2)
  expect([...new Set(patched)]).toEqual(['b0'])
  // Starter detail still lists every participant with its own status.
  await page.evaluate(() => { location.hash = 'starter/s' })
  await expect(page.getByText('Shared scene',{ exact:true })).toBeVisible()
  await expect(page.locator('article.branch-card')).toHaveCount(3)
  await expect(card(page,'One').locator('.status-badge')).toHaveText('Archived')
  await expect(card(page,'Two').locator('.status-badge')).toHaveText('Your turn')
  await expect(card(page,'Three').locator('.status-badge')).toHaveText('Your turn')
})

test('creates a shared starter and adds a participant without duplicating it', async ({ page }) => {
  let saved: any, added: any
  const rows: any[] = []
  await signedIn(page)
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[{ id:'p',name:'Partner' }] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches:[],yourTurnCount:0,overdueDraftCount:0,dueSoonCount:0 } })
    if (path === '/api/starters' && method === 'POST') { saved = route.request().postDataJSON(); return route.fulfill({ status:201,json:{ id:'s',...saved } }) }
    if (path === '/api/starters/s') return route.fulfill({ json:{ starter:{ id:'s',...saved },branches:rows } })
    if (path === '/api/starters/s/branches') {
      added = route.request().postDataJSON()
      rows.push({ id:'b',starterId:'s',...saved,characterName:'Writer',partnerLabel:'Partner',status:'your_turn',...added })
      return route.fulfill({ status:201,json:rows[0] })
    }
    return route.fallback()
  })
  await page.goto('/')
  // Quick Add is hidden until its #quick-add anchor is targeted.
  await page.getByRole('link',{ name:'+ Add a thread' }).click()
  const quickAdd = page.locator('#quick-add')
  await quickAdd.getByLabel('Scene label').fill('Rooftop scene')
  await quickAdd.getByLabel('Character',{ exact:true }).selectOption('c')
  await quickAdd.getByLabel('Scene premise').fill('Shared by every branch')
  await quickAdd.getByRole('button',{ name:'Add thread',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'Rooftop scene',exact:true })).toBeVisible()
  expect(saved).toMatchObject({ title:'Rooftop scene',characterId:'c',description:'Shared by every branch' })
  const addForm = page.locator('form').filter({ hasText:'Add a writing partner' })
  await addForm.getByLabel('Partner').selectOption('p')
  await addForm.getByLabel('Branch notes').fill('Only for this participant')
  await addForm.getByRole('button',{ name:'Add branch',exact:true }).click()
  await expect(page.locator('article.branch-card')).toHaveCount(1)
  await expect(page.getByLabel('Scene summary')).toHaveValue(/Shared by every branch/)
  expect(added).toEqual({ partnerId:'p',notes:'Only for this participant' })
})

test('direct starter navigation updates the record and participant action target', async ({ page }) => {
  const fetched: string[] = [], targets: string[] = []
  await signedIn(page)
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[],partners:[] } })
    const match = /^\/api\/starters\/(one|two)(\/branches)?$/.exec(path)
    if (!match) return route.fallback()
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
  await signedIn(page)
  await page.route('**/api/**',async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[],partners:[] } })
    const match = /^\/api\/starters\/(one|two)$/.exec(path)
    if (!match) return route.fallback()
    const id = match[1]
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
  await signedIn(page)
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches,yourTurnCount:0,overdueDraftCount:0,dueSoonCount:0 } })
    if (path === '/api/starters/s') return route.fulfill({ json:{ starter,branches } })
    return route.fallback()
  })
  const check = async () => {
    await expand(page,'Friend')
    await expand(page,'Other')
    await expect(card(page,'Friend').getByRole('status')).toHaveText('Refresh needs attention: Tumblr refresh failed (503)')
    await expect(card(page,'Other').getByLabel('Status')).toBeVisible()
    await expect(card(page,'Other').getByRole('status')).toHaveCount(0)
  }
  await page.goto('/')
  await check()
  await page.evaluate(() => { location.hash = 'starter/s' })
  await expect(page.getByRole('heading',{ name:'Refresh test',exact:true })).toBeVisible()
  await check()
})
