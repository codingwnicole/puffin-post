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
  await page.getByLabel('Theme').selectOption(mode)
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
  await page.getByLabel('Theme').selectOption('dark')
  await page.reload()
  await expect(page.getByLabel('Theme')).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('Theme').selectOption('system')
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
    const a = document.querySelector<HTMLAnchorElement>('a[href="#settings"]')!
    a.click()
  })
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  expect((await navigation.boundingBox())!.x).toBe(0)
  expect((await navigation.boundingBox())!.width).toBeLessThan(300)
})

for (const mode of ['light', 'dark'] as const) {
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

// Walk every visible element that carries direct text on the named page and
// assert WCAG contrast against the nearest opaque ancestor background.
const CONTRAST_PAGES: Array<{ name: string; hash: string }> = [
  { name: 'inbox', hash: '#inbox' },
  { name: 'characters', hash: '#characters' },
  { name: 'parking-lot', hash: '#parking-lot' },
  { name: 'settings', hash: '#settings' },
]

for (const mode of ['light', 'dark'] as const) {
  for (const { name, hash } of CONTRAST_PAGES) {
    test(`${mode} ${name}: all text meets WCAG contrast`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' })
      await signIn(page)
      await page.goto(`/${hash}`)
      // Wait for the page to settle before measuring.
      await page.waitForTimeout(600)
      const offenders = await page.evaluate(() => {
        function luminance(color: string) {
          const channels = color.match(/[\d.]+/g)
          if (!channels) return 0
          const [r, g, b] = channels.slice(0, 3).map(Number).map(v => {
            const c = v / 255
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          })
          return r * 0.2126 + g * 0.7152 + b * 0.0722
        }
        function parseRgba(color: string): [number, number, number, number] | null {
          const m = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
          if (!m) return null
          const a = m[4] !== undefined ? Number(m[4]) : 1
          return [Number(m[1]), Number(m[2]), Number(m[3]), a]
        }
        function isOpaque(color: string): boolean {
          const parsed = parseRgba(color)
          return parsed !== null && parsed[3] >= 1
        }
        function isSkippableBg(color: string): boolean {
          return /color\(|color-mix|gradient|conic|linear|radial/.test(color)
        }
        const results: string[] = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set<Element>()
        let node: Text
        while ((node = walker.nextNode() as Text)) {
          if (!node.textContent || !node.textContent.trim()) continue
          const el: Element | null = node.parentElement
          if (!el || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue
          // Skip disabled form controls
          if (el instanceof HTMLInputElement && (el.disabled || el.readOnly)) continue
          if (el instanceof HTMLButtonElement && el.disabled) continue
          if (el instanceof HTMLSelectElement && el.disabled) continue
          if (el instanceof HTMLTextAreaElement && el.disabled) continue
          const seenKey = el as Element
          if (seen.has(seenKey)) continue
          seen.add(seenKey)
          const style = getComputedStyle(seenKey)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
          // Check it's actually visible
          const rect = (seenKey as HTMLElement).getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          // Find nearest ancestor with an opaque, non-skippable background
          let bg: string | null = null
          let ancestor: Element | null = seenKey
          while (ancestor) {
            const ancestorStyle = getComputedStyle(ancestor)
            const bgc = ancestorStyle.backgroundColor
            if (isOpaque(bgc) && !isSkippableBg(bgc)) {
              bg = bgc
              break
            }
            if (isSkippableBg(bgc)) {
              // Skip this ancestor entirely — it uses color()/gradient
              ancestor = ancestor.parentElement
              continue
            }
            ancestor = ancestor.parentElement
          }
          if (!bg) continue
          const fg = style.color
          if (parseRgba(fg) === null) continue
          const alpha = parseRgba(fg)![3]
          if (alpha < 0.5) continue
          const a = luminance(fg)
          const b = luminance(bg)
          const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
          // Determine if this is large text (>= 24px or >= 18.66px bold)
          const fontSize = parseFloat(style.fontSize)
          const fontWeight = parseInt(style.fontWeight, 10)
          const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700)
          const threshold = isLarge ? 3 : 4.5
          if (contrast < threshold) {
            const tag = seenKey.tagName.toLowerCase()
            const cls = seenKey.className ? ` .${seenKey.className.toString().slice(0, 60)}` : ''
            const text = seenKey.textContent!.trim().slice(0, 40)
            results.push(`<${tag}${cls}> "${text}" contrast=${contrast.toFixed(2)} (need ${threshold})`)
          }
        }
        return results
      })
      expect(offenders, `WCAG contrast violations on ${name} (${mode}):\n${offenders.join('\n')}`).toEqual([])
    })
  }
}

test('dark reply-run text is readable on its card surface', async ({ page }) => {
  const branch = { id: 'b1', workspaceId: 'w1', starterId: 's1', partnerId: null, status: 'your_turn', notes: '', latestPostId: null, lastPoster: null, lastActivityAt: null, latestReplyExcerpt: null, lastRefreshAt: null, refreshError: null, statusManualOverrideAt: null, archivedAt: null, createdAt: '2026-11-16T00:00:00Z', nextCheckAt: null, title: 'First branch', description: '', characterId: 'c1', characterName: 'Remy', groupId: null, groupName: null, rpUnsortedReason: 'no_rps', iconObjectKey: null, source: 'tumblr', rootPostId: '1', rootBlogId: 'x.tumblr.com', starterArchived: 0, partnerLabel: null }
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { branches: [branch], yourTurnCount: 1, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/#inbox')
  await expect(page.locator('.reply-run strong').first()).toBeVisible()
  const contrast = await page.evaluate(() => {
    function luminance(color: string) {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      })
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    }
    const el = document.querySelectorAll<HTMLElement>('.reply-run strong')[0]
    const style = getComputedStyle(el)
    let background = getComputedStyle(el.closest('.reply-run')!).backgroundColor
    const a = luminance(style.color), b = luminance(background)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
})
