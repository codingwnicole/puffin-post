import { expect, test, type Browser } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })

async function signedInPage(browser: Browser) {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const context = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': ip, origin: APP } })
  const page = await context.newPage()
  const email = `sprint-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
  await createSignedInUser(page, { email, password: 'correct horse battery' })
  return { context, page }
}

test('solo sprint keeps replies separate, saves locally, and uploads totals only', async ({ browser }) => {
  const { context, page } = await signedInPage(browser)
  await page.goto('/#tools/sprints')
  await page.getByRole('button', { name: 'Set up a solo sprint' }).click()
  await page.getByLabel('Custom minutes').fill('1')
  await page.getByRole('button', { name: 'Start solo sprint' }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()

  await page.getByLabel('Reply text').first().pressSequentially('first reply words')
  await page.getByRole('button', { name: 'Finish & Copy' }).click()
  await page.getByLabel('Reply text').first().pressSequentially('second reply words')
  await page.getByRole('button', { name: 'Finish & Copy' }).click()

  const savedHistory = page.waitForResponse(response => response.url().endsWith('/api/sprints') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'End early' }).click()
  expect((await savedHistory).status()).toBe(201)

  const history = await (await page.request.get('/api/sprints')).json() as Array<{
    wordsCredited: number; repliesCompleted: number; title: string
  }>
  expect(history[0].wordsCredited).toBe(6)
  expect(history[0].repliesCompleted).toBe(2)
  expect(JSON.stringify(history)).not.toContain('first reply words')
  expect(JSON.stringify(history)).not.toContain('second reply words')

  await page.getByRole('link', { name: 'Writing sprints' }).click()
  await expect(page.getByRole('heading', { name: 'Saved sprint drafts' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/6 words.*2 replies/)).toBeVisible()
  await context.close()
})

test('private room keeps guest reply text private while sharing progress', async ({ browser }) => {
  const { context, page: host } = await signedInPage(browser)
  await host.goto('/#tools/sprints')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.getByLabel('Room name').fill('Late night replies')
  await host.getByLabel('Your room display name').fill('Host')
  await host.getByLabel('Custom minutes').fill('1')
  await host.getByRole('button', { name: 'Create private room' }).click()
  await expect(host.getByRole('heading', { name: 'Late night replies' })).toBeVisible()
  await expect(host.locator('.sprint-room-panel [role="status"]')).toHaveText('Connected')

  const guestIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const guestContext = await browser.newContext({ baseURL: APP, extraHTTPHeaders: { 'cf-connecting-ip': guestIp, origin: APP } })
  const guest = await guestContext.newPage()
  await guest.goto(host.url())
  await guest.getByLabel('Display name').fill('Guest')
  await guest.getByRole('button', { name: 'Join sprint room' }).click()
  await expect(guest.getByRole('heading', { name: 'Writers' })).toBeVisible()
  await expect(host.getByText('Guest', { exact: true })).toBeVisible()

  await host.getByRole('button', { name: 'Start round' }).click()
  await expect(guest.getByText('The room timer is running.')).toBeVisible()
  await guest.getByLabel('Reply text').first().pressSequentially('private guest reply')
  await guest.getByRole('button', { name: 'Finish & Copy' }).click()
  await expect(host.getByText(/1 replies/)).toBeVisible()
  await expect(host.getByLabel('Reply text').first()).toHaveValue('')
  await expect(host.getByText('private guest reply')).toHaveCount(0)

  await guestContext.close()
  await context.close()
})
