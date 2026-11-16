import { expect, test, type Page } from '@playwright/test'

// The signed-in shell only renders after GET /api/auth/session returns 200,
// so the route mock answers it directly; no real form flow is exercised.
async function signIn(page: Page) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByText('Keep every thread moving.')).toBeVisible({ timeout: 15000 })
}

async function setMode(page: Page, mode: 'light' | 'dark') {
  await page.getByLabel('Appearance').selectOption(mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

test('keyboard skip link focuses content without leaving the selected page', async ({ page }) => {
  await signIn(page)
  await page.goto('/#settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('system preference follows changes until the user chooses a mode', async ({ page }) => {
  await signIn(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/#settings')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByLabel('Appearance').selectOption('dark')
  await page.reload()
  await expect(page.getByLabel('Appearance')).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Appearance').selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('390px layout uses bottom navigation without horizontal scrolling', async ({ page }) => {
  await signIn(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Primary' })
  await expect(navigation).toBeVisible()
  const box = await navigation.boundingBox()
  expect(box!.y).toBeGreaterThan(700)
  expect(box!.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await navigation.getByText('More').click()
  await expect(navigation.getByRole('link', { name: 'Settings' })).toBeVisible()
  await page.evaluate(() => {
    const a = document.querySelector('a[href="#settings"]')!
    a.click()
  })
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  expect((await navigation.boundingBox())!.x).toBe(0)
  expect((await navigation.boundingBox())!.width).toBeLessThan(300)
})

for (const mode of ['light', 'dark']) {
  test(`${mode} retains readable text and controls`, async ({ page }) => {
    // Inputs fade background-color; measure settled colors, not mid-transition.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await signIn(page)
    await page.goto('/#settings')
    await setMode(page, mode)
    const contrasts = await page.evaluate(() => {
      function luminance(color: string) {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        })
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
      }
      return ['.page-heading', '.settings-section p', '.primary-nav a[aria-current="page"]', '.theme-menu select'].map(selector => {
        const element = document.querySelector(selector)
        if (!element) return { selector, contrast: -1 }
        const style = getComputedStyle(element)
        let background = style.backgroundColor
        let ancestor = element.parentElement
        while (background === 'rgba(0, 0, 0, 0)' && ancestor) {
          background = getComputedStyle(ancestor).backgroundColor
          ancestor = ancestor.parentElement
        }
        const a = luminance(style.color), b = luminance(background)
        return { selector, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      })
    })
    for (const { selector, contrast } of contrasts) {
      if (contrast < 0) continue
      expect(contrast, `${selector}: contrast ${contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test(`${mode} keeps custom avatar initials readable after icon failure`, async ({ page }) => {
    await signIn(page)
    await page.goto('/#settings')
    await setMode(page, mode)
    await page.route('**/missing-avatar.png', route => route.abort())
    await page.evaluate(async () => {
      const reactPath = '/node_modules/.vite/deps/react.js'
      const clientPath = '/node_modules/.vite/deps/react-dom_client.js'
      const avatarPath = '/src/web/components/InitialsAvatar.tsx'
      const [{ default: { createElement } }, { default: { createRoot } }, { InitialsAvatar }] = await Promise.all([
        import(reactPath), import(clientPath), import(avatarPath),
      ])
      const fixture = document.createElement('div')
      fixture.id = 'avatar-fixture'
      document.querySelector('main')!.appendChild(fixture)
      const colors = ['#ffffff', '#2b1724', '#fff', '#000', '#808080', '#00FF00', '#ff0000', '#0000ff', 'transparent', '#ffffff00', '#xyz', undefined]
      createRoot(fixture).render(createElement('div', null, ...colors.flatMap(color => [
        createElement(InitialsAvatar, { key: `${color}-initials`, name: 'Parisa Farzaneh', color }),
        createElement(InitialsAvatar, { key: `${color}-failed`, name: 'Parisa Farzaneh', color, imageUrl: '/missing-avatar.png' }),
      ])))
    })
    await expect(page.locator('#avatar-fixture .initials-avatar')).toHaveCount(24)
    await expect(page.locator('#avatar-fixture img')).toHaveCount(0)
    await expect(page.locator('#avatar-fixture [role="img"]')).toHaveCount(24)
    const avatars = await page.locator('#avatar-fixture .initials-avatar').evaluateAll(elements => {
      function luminance(color: string) {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        })
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
      }
      return elements.map(element => {
        const style = getComputedStyle(element)
        const a = luminance(style.color), b = luminance(style.backgroundColor)
        return { text: element.textContent, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      })
    })
    expect(avatars[0].background).toBe('rgb(255, 255, 255)')
    expect(avatars[2].background).toBe('rgb(43, 23, 36)')
    for (const avatar of avatars) {
      expect(avatar.text).toBe('PF')
      expect(avatar.contrast).toBeGreaterThanOrEqual(4.5)
    }
  })
}
