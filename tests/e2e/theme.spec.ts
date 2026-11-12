import { expect, test } from '@playwright/test'

test('keyboard skip link focuses content without leaving the selected page', async ({ page }) => {
  await page.goto('/#settings')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('system preference follows changes until the user chooses a mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/#settings')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByLabel('Appearance').selectOption('dark')
  await page.getByLabel('Palette').selectOption('violet')
  await page.reload()
  await expect(page.getByLabel('Appearance')).toHaveValue('dark')
  await expect(page.getByLabel('Palette')).toHaveValue('violet')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'violet')
  await page.getByLabel('Appearance').selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('390px layout uses bottom navigation without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Primary' })
  await expect(navigation).toBeVisible()
  const box = await navigation.boundingBox()
  expect(box!.y).toBeGreaterThan(700)
  expect(box!.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await navigation.getByRole('button', { name: 'More' }).click()
  await navigation.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  expect((await navigation.boundingBox())!.x).toBe(0)
  expect((await navigation.boundingBox())!.width).toBeLessThan(300)
})

for (const palette of ['rose', 'violet', 'ocean', 'sage', 'ember', 'midnight']) {
  for (const mode of ['light', 'dark']) {
    test(`${palette} ${mode} retains readable text and controls`, async ({ page }) => {
      await page.goto('/#settings')
      await page.getByLabel('Appearance').selectOption(mode)
      await page.getByLabel('Palette').selectOption(palette)
      await expect(page.locator('html')).toHaveAttribute('data-palette', palette)
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
      const contrasts = await page.evaluate(() => {
        function luminance(color: string) {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
            const channel = value / 255
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
          })
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
        }
        return ['.page-heading', '.settings-section p', '.primary-nav a[aria-current="page"]', '.theme-menu select'].map(selector => {
          const element = document.querySelector(selector)!
          const style = getComputedStyle(element)
          let background = style.backgroundColor
          let ancestor = element.parentElement
          while (background === 'rgba(0, 0, 0, 0)' && ancestor) {
            background = getComputedStyle(ancestor).backgroundColor
            ancestor = ancestor.parentElement
          }
          const a = luminance(style.color), b = luminance(background)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
      })
      for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5)
    })

    test(`${palette} ${mode} keeps custom avatar initials readable after icon failure`, async ({ page }) => {
      await page.goto('/#settings')
      await page.getByLabel('Appearance').selectOption(mode)
      await page.getByLabel('Palette').selectOption(palette)
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
}
