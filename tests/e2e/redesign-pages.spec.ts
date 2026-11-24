// Redesign phase 4: every remaining page renders on the new layer at desktop and phone width with real data,
// with no sideways scroll. Screenshots land in test-results/pages/ for review.
import { expect, test } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })
test.setTimeout(180_000)

const PAGES: [route: string, heading: RegExp][] = [
  ['parking-lot', /Parking Lot/i], ['activity', /Tumblr activity/i], ['planner', /Character planner/i], ['tools', /Writing tools/i],
  ['tools/sprints', /Writing sprints/i], ['connections', /Connected accounts/i], ['settings', /^Settings$/], ['roadmap', /Site roadmap/i],
  ['support', /Support/i], ['terms', /Terms/i],
]

test('remaining pages render on the redesign at 1440 and 390 without sideways scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.8.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#dashboard')
  await createSignedInUser(page)
  const api = page.request
  const { id: characterId } = await (await api.post('/api/characters', { data: { name: 'Wren' } })).json() as { id: string }
  const { id: starterId } = await (await api.post('/api/starters', { data: { characterId, title: 'Harbor at dusk', partnerName: 'Ash', description: 'Rain on the docks.' } })).json() as { id: string }
  await api.post('/api/reply-drafts', { data: { title: 'Reply to Ash', notes: 'Keep the lamp.', purpose: 'reply' } })
  await api.post('/api/reply-drafts', { data: { title: 'Plot the Brig break', notes: 'Who has the key?', purpose: 'plotting' } })
  await api.post('/api/character-planner', { data: { name: 'Odile Fenn', faceclaim: 'harbor smuggler', notes: 'needs a hook' } })

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 700 ? 900 : 844 })
    for (const [route, heading] of [...PAGES, [`starter/${starterId}`, /Harbor at dusk/] as [string, RegExp]]) {
      await page.goto(`/#${route}`); await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible({ timeout: 15000 })
      await page.waitForTimeout(450) // entrance and page transition settle
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${route} at ${width}px scrolls sideways`).toBe(true)
      await page.screenshot({ path: `test-results/pages/${route.replace(/\//g, '-')}-${width}.png`, fullPage: width > 700 })
    }
  }
  await ctx.close()
})

test('deeper states render on the redesign: support board, solo sprint, private room, check your email', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  const shoot = async (name: string) => {
    await page.waitForTimeout(450)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} scrolls sideways`).toBe(true)
    await page.screenshot({ path: `test-results/pages/${name}.png`, fullPage: true })
  }

  await page.route('**/api/auth/magic-link', route => route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/'); await page.reload()
    await page.getByRole('textbox', { name: 'Email address' }).first().fill('writer@example.test')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await shoot(`check-email-${width}`)
  }
  await page.unroute('**/api/auth/magic-link')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#dashboard')
  await createSignedInUser(page)
  const runTag = Date.now().toString(36)
  await page.request.post('/api/support', { data: { kind: 'feature', title: `Dark mode for the public page ${runTag}`, description: 'Would love it to follow my theme.' } })
  await page.request.post('/api/support', { data: { kind: 'bug', title: 'Spin wheel skips archived', description: 'Expected, but worth a note.' } })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#support'); await page.reload()
    await expect(page.getByText(`Dark mode for the public page ${runTag}`)).toBeVisible()
    await shoot(`support-items-${width}`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#tools/sprints'); await page.reload()
  await page.getByRole('button', { name: 'Set up a solo sprint' }).click()
  await shoot('sprint-solo-setup-1440')
  await page.getByLabel('Custom minutes').fill('1')
  await page.getByRole('button', { name: 'Start solo sprint' }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByLabel('Reply text').first().pressSequentially('the lamp is still lit')
  await shoot('sprint-solo-running-1440')
  await page.setViewportSize({ width: 390, height: 844 })
  await shoot('sprint-solo-running-390')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#tools/sprints'); await page.reload()
  await page.getByRole('button', { name: 'Create room' }).click()
  await page.getByLabel('Room name').fill('Late night replies')
  await page.getByLabel('Your room display name').fill('Host')
  await page.getByLabel('Custom minutes').fill('1')
  await page.getByRole('button', { name: 'Create private room' }).click()
  await expect(page.getByRole('heading', { name: 'Late night replies' })).toBeVisible()
  await shoot('sprint-room-1440')
  await page.setViewportSize({ width: 390, height: 844 })
  await shoot('sprint-room-390')
  await ctx.close()
})

test('desk themes recolour the accent, survive a reload and pair with dark mode', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#dashboard')
  await createSignedInUser(page)
  await page.request.post('/api/characters', { data: { name: 'Wren' } })
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase())
  await page.goto('/#settings'); await page.reload()
  expect(await accent()).toBe('#56715B')
  for (const [label, light, dark] of [['Tidepool', '#3E6870', '#98C4C9'], ['Lavender hour', '#685C88', '#C2B8DF'], ['Mushroom', '#7A5F49', '#D6BBA2']]) {
    await page.goto('/#settings')
    await page.getByRole('radio', { name: label }).check()
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('light')
    expect(await accent()).toBe(light)
    await page.goto('/#dashboard'); await page.reload() // applied at startup, not only on Settings
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    expect(await accent()).toBe(light)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `test-results/pages/desk-${label.split(' ')[0].toLowerCase()}-light.png` })
    await page.goto('/#settings')
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark')
    expect(await accent()).toBe(dark)
    await page.goto('/#dashboard'); await page.reload()
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForTimeout(450)
    await page.screenshot({ path: `test-results/pages/desk-${label.split(' ')[0].toLowerCase()}-dark.png` })
  }
  await page.goto('/#settings')
  await page.getByRole('radio', { name: 'Meadow' }).check()
  expect(await accent()).toBe('#A3C0A4')
  await page.getByRole('group', { name: 'Desk theme' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/pages/desk-settings-dark.png' })
  await ctx.close()
})
