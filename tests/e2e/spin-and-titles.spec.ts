// Spin the wheel, turn markers and the add-thread title flow (simulated Chromium, real Worker + local D1).
import { expect, test, type Browser } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

async function signedIn(browser: Browser) {
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const context = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': ip, origin: APP } })
  const page = await context.newPage()
  const email = `spin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
  await createSignedInUser(page, { email })
  return { context, page }
}

test('spin the wheel picks a your-turn thread, highlights it, and is disabled when nothing is your turn', async ({ browser }) => {
  const { context, page } = await signedIn(browser)
  await page.goto('/#inbox')
  // An empty inbox shows onboarding, not the reply-run card, so there is no wheel yet.
  await expect(page.getByRole('heading', { name: 'Build a space that keeps up with your stories.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Spin the wheel' })).toHaveCount(0)
  const { id: characterId } = await (await page.request.post('/api/characters', { data: { name: 'Wren' } })).json() as { id: string }
  const titles = ['Harbor at dusk', 'Library heist', 'Snowed-in inn']
  for (const title of titles) expect((await page.request.post('/api/starters', { data: { characterId, title, partnerName: 'Ash' } })).status()).toBe(201)
  await page.addInitScript(() => { Math.random = () => 0.5 }) // picks the middle one of three
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.locator('.turn-your_turn').first()).toBeVisible()
  await page.getByRole('button', { name: 'Spin the wheel' }).click()
  const status = page.locator('.spin-wheel p')
  await expect(status).toContainText('Reply to this one?')
  const picked = (await status.locator('strong').textContent()) ?? ''
  expect(titles).toContain(picked)
  await expect(page.locator('.branch-card.is-picked')).toContainText(picked)
  await page.setViewportSize({ width: 1280, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'test-results/t9d-inbox-1280.png' })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.screenshot({ path: 'test-results/t9d-inbox-1280-dark.png' }); await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: 'test-results/t9d-inbox-375.png', fullPage: true })
  // Parking lot has its own spin over open drafts.
  for (const title of ['Plot with Ash', 'Ask reply']) expect((await page.request.post('/api/reply-drafts', { data: { title, notes: 'x', purpose: 'plotting' } })).status()).toBe(201)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/#parking-lot'); await page.reload()
  await page.getByRole('button', { name: 'Spin the wheel' }).click()
  await expect(page.locator('.spin-wheel p')).toContainText('Reply to this one?')
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'test-results/t9d-parking-1280.png' })
  await context.close()
})

test('a pasted link matched to one character gets a title with both names, and a typed title is never replaced', async ({ browser }) => {
  const { context, page } = await signedIn(browser)
  const { id: characterId } = await (await page.request.post('/api/characters', { data: { name: 'Wren' } })).json() as { id: string }
  // Tumblr is not reachable in tests, so the post read is stubbed; the form logic under test is real.
  await page.route('**/api/starters/resolve', async route => {
    const body = route.request().postDataJSON() as { characterId?: string }
    return route.fulfill({ json: body.characterId === characterId
      ? { title: 'raw post text', suggestedTitle: 'Wren × Ash', preview: 'Rain on the docks.', sourceBlogAssigned: true, participants: ['ash.tumblr.com'], suggestedPartner: 'ash.tumblr.com', titleNeedsPartner: false, characterName: 'Wren', candidates: [{ characterId, characterName: 'Wren', characterTag: null }] }
      : { title: 'raw post text', preview: 'Rain on the docks.', sourceBlogAssigned: true, participants: ['ash.tumblr.com'], suggestedPartner: 'ash.tumblr.com', candidates: [{ characterId, characterName: 'Wren', characterTag: null }] } })
  })
  await page.goto('/#inbox')
  await page.getByRole('link', { name: '+ Add a thread' }).click()
  await page.getByLabel('Post or message link').fill('https://www.tumblr.com/mine/123')
  await page.getByLabel('Post or message link').blur()
  await expect(page.getByLabel(/Scene label/)).toHaveValue('Wren × Ash')
  await expect(page.getByLabel('Scene premise')).toHaveValue('Rain on the docks.')
  await page.getByLabel(/Scene label/).fill('My own title')
  await page.locator('#quick-add').getByLabel('Character', { exact: true }).selectOption(characterId)
  await expect(page.getByLabel(/Scene label/)).toHaveValue('My own title')
  await context.close()
})
