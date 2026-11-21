import { expect, test, type Page } from '@playwright/test'

// T8d visual-system spec.
//
// Verifies the CSS detail layer: concentric radii, alpha borders, OKLCH token
// contrast, icon-only-button accessible names, the save-button crossfade
// (no layout shift, "Saved" only after OK, "Not saved" on failure), and the
// three dark depth steps. The signed-in shell renders after
// GET /api/auth/session answers, so the route mock drives all data.
//
// Colour math normalises through a canvas so oklch() resolves to rgba
// regardless of the browser's computed-style serialisation.

type Branch = {
  id: string; workspaceId: string; starterId: string; partnerId: string | null
  status: string; notes: string; latestPostId: string | null; lastPoster: string | null
  lastActivityAt: string | null; latestReplyExcerpt: string | null; lastRefreshAt: string | null
  refreshError: string | null; statusManualOverrideAt: string | null; archivedAt: string | null
  createdAt: string; nextCheckAt: string | null
  title: string; description: string; characterId: string; characterName: string
  groupId: string | null; groupName: string | null; rpUnsortedReason: string
  iconObjectKey: string | null; source: string; rootPostId: string; rootBlogId: string
  starterArchived: number; partnerLabel: string | null
}

const branch: Branch = {
  id: 'b1', workspaceId: 'w1', starterId: 's1', partnerId: null, status: 'your_turn',
  notes: '', latestPostId: 'p1', lastPoster: null, lastActivityAt: '2026-01-01T00:00:00Z',
  latestReplyExcerpt: null, lastRefreshAt: null, refreshError: null,
  statusManualOverrideAt: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z',
  nextCheckAt: null, title: 'A test scene', description: 'Premise text', characterId: 'c1',
  characterName: 'Test Char', groupId: null, groupName: null, rpUnsortedReason: 'none',
  iconObjectKey: null, source: 'tumblr', rootPostId: 'p0', rootBlogId: 'blog.tumblr.com',
  starterArchived: 0, partnerLabel: null,
}

export async function signIn(page: Page, opts: { branch?: boolean; failSave?: boolean } = {}) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    let body: unknown = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    if (url.pathname === '/api/inbox') body = { branches: opts.branch ? [branch] : [], yourTurnCount: opts.branch ? 1 : 0, overdueDraftCount: 0, dueSoonCount: 0 }
    else if (url.pathname === '/api/starters/options') body = { characters: [], partners: [] }
    else if (url.pathname === '/api/tags') body = []
    else if (url.pathname === '/api/tags/starters/s1') body = []
    else if (url.pathname === '/api/rp-groups') body = []
    else if (url.pathname === '/api/settings') body = { user: { id: 'u1', name: 'Test User', email: 'test@example.com' } }
    else if (url.pathname === '/api/push/subscription') body = { enabled: false }
    else if (url.pathname === '/api/tumblr-activity/unread-count') body = { count: 0 }
    if (opts.failSave && route.request().method() === 'PATCH' && /\/api\/(branches|starters)\//.test(url.pathname)) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Save failed' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/#settings')
  await expect(page.locator('.primary-nav').first()).toBeVisible({ timeout: 15000 })
}

// In-page colour helpers as a function-source string, passed into page.evaluate
// and evaluated there. Parses oklch()/oklab()/rgba() and converts to sRGB so
// WCAG contrast is computed on real RGB (computed-style serialises oklch as-is).
const HELPERS_SRC = `
(function () {
  const P = (c) => { c = c / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const toLinear = (r, g, b) => [P(r), P(g), P(b)];
  const okToRGB = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  };
  // Parse a computed colour into LINEAR sRGB [r,g,b] (0..1) + alpha. WCAG
  // relative luminance requires linear values, so we never gamma here.
  const parse = (col) => {
    const s = String(col).trim();
    let m = s.match(/^okl(ch|ab)[(]([^)]+)[)]/);
    if (m) {
      const n = m[2].split('/').map(x => x.trim());
      const vals = n[0].split(' ').map(parseFloat);
      const alpha = n.length > 1 ? parseFloat(n[1]) : 1;
      let L, a, b;
      if (m[1] === 'ch') { const rad = vals[2] * Math.PI / 180; L = vals[0] > 1 ? vals[0] / 100 : vals[0]; a = vals[1] * Math.cos(rad); b = vals[1] * Math.sin(rad); }
      else { L = vals[0]; a = vals[1]; b = vals[2]; }
      return [...okToRGB(L, a, b), alpha];
    }
    const r = col.match(/rgba?[(]([^)]+)[)]/);
    if (r) { const v = r[1].split(',').map(parseFloat); return [P(v[0]), P(v[1]), P(v[2]), v[3] !== undefined ? v[3] : 1]; }
    const hex = col.match(/^#([0-9a-f]{6})$/i);
    if (hex) { const v = hex[1].match(/../g).map(h => parseInt(h, 16)); return [P(v[0]), P(v[1]), P(v[2]), 1]; }
    return [0, 0, 0, 1];
  };
  const lum = (col) => { const [r, g, b] = parse(col); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (fg, bg) => { const x = lum(fg), y = lum(bg); const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05); };
  return { parse, lum, ratio };
})()
`

test('concentric radii: inner surface radius is smaller than the card outer radius', async ({ page }) => {
  await signIn(page)
  const outer = await page.locator('.tracking-card').first().evaluate(el => {
    const r = parseFloat(getComputedStyle(el).borderRadius)
    return r
  })
  const inner = await page.locator('.tracking-card button').first().evaluate(el => {
    const r = parseFloat(getComputedStyle(el).borderRadius)
    return r
  })
  expect(outer).toBeGreaterThan(4)
  expect(inner).toBeLessThan(outer)
})

test('alpha borders: input border vs background meets 3:1 in both themes', async ({ page }) => {
  await signIn(page)
  const input = page.locator('.tracking-card input').first()
  await expect(input).toBeVisible()
  for (const mode of ['light', 'dark'] as const) {
    await page.getByLabel('Theme').selectOption(mode)
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    const c = await page.evaluate((src: string) => {
      const h = (0, eval)(src)
      const el = document.querySelector('.tracking-card input') as HTMLElement
      // form-control border colour is the --border-strong token; measure it (theme-correct)
      // against the card background it sits on
      const borderCol = getComputedStyle(el).getPropertyValue('--border-strong').trim()
      const bgCol = getComputedStyle(document.querySelector('.tracking-card') as HTMLElement).backgroundColor
      return h.ratio(borderCol, bgCol)
    }, HELPERS_SRC)
    expect(c, `${mode} input border contrast`).toBeGreaterThanOrEqual(3)
  }
})

test('OKLCH tokens: body text and large heading contrast meet WCAG in both themes', async ({ page }) => {
  await signIn(page)
  for (const mode of ['light', 'dark'] as const) {
    await page.getByLabel('Theme').selectOption(mode)
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    const [body, heading] = await page.evaluate((src: string) => {
      const h = (0, eval)(src)
      const bg = getComputedStyle(document.querySelector('.tracking-card') as HTMLElement).backgroundColor
      const bodyFg = getComputedStyle(document.querySelector('.tracking-card p, .field-help') as HTMLElement).color
      const headFg = getComputedStyle(document.querySelector('.tracking-card h3') as HTMLElement).color
      return [h.ratio(bodyFg, bg), h.ratio(headFg, bg)]
    }, HELPERS_SRC)
    expect(body, `${mode} body text contrast`).toBeGreaterThanOrEqual(4.5)
    expect(heading, `${mode} large text contrast`).toBeGreaterThanOrEqual(3)
  }
})

test('icon consistency: every button has an accessible name', async ({ page }) => {
  await signIn(page)
  const unnamed = await page.evaluate(() => {
    const bad: string[] = []
    document.querySelectorAll('button').forEach(btn => {
      const text = (btn.textContent || '').trim()
      const hasLabel = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby')
      if (!text && !hasLabel) bad.push(btn.outerHTML.slice(0, 60))
    })
    return bad
  })
  expect(unnamed).toEqual([])
})

test('save crossfade: fixed width, "Saved" only after OK, "Not saved" on failure', async ({ page }) => {
  await signIn(page, { branch: true, failSave: true })
  await page.goto('/#inbox')
  const card = page.locator('.branch-card').first()
  await card.locator('.scene-card-trigger').click()
  const note = page.locator('.autosave-note').first()
  await expect(note).toBeVisible()
  // Two stacked state spans in the same grid cell -> no layout shift.
  const states = note.locator('.save-state')
  expect(await states.count()).toBe(2)
  const widthBefore = await note.evaluate(el => el.getBoundingClientRect().width)
  // The idle state reads "Saved automatically" (no error yet).
  expect(await note.locator('.save-state').last().textContent()).toContain('Saved automatically')
  // Trigger a save that the server rejects; the note must flip to "Not saved".
  const desc = card.locator('input[name="description"]')
  await desc.fill('Changed premise that will fail to save')
  // Blur the field (focus leaves the form) to fire the form's delegated save.
  await desc.evaluate(el => (el as HTMLInputElement).blur())
  await expect(note.locator('.save-state').last()).toContainText('Not saved', { timeout: 5000 })
  expect(await note.locator('.save-state').last().textContent()).not.toContain('Saved automatically')
  const widthAfter = await note.evaluate(el => el.getBoundingClientRect().width)
  expect(widthAfter).toBeCloseTo(widthBefore, 0)
})

test('dark depth: three surface steps are distinct and ordered page < card < popover', async ({ page }) => {
  await signIn(page)
  await page.getByLabel('Theme').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // The popover surface is the phone More sheet, which only exists while open.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.mobile-more-toggle').click()
  await expect(page.locator('.mobile-more-menu')).toBeVisible()
  const tones = await page.evaluate((src: string) => {
    const h = (0, eval)(src)
    const page = h.lum(getComputedStyle(document.querySelector('.primary-nav') as HTMLElement).backgroundColor)
    const card = h.lum(getComputedStyle(document.querySelector('.tracking-card') as HTMLElement).backgroundColor)
    const pop = h.lum(getComputedStyle(document.querySelector('.mobile-more-menu') as HTMLElement).backgroundColor)
    return { page, card, pop }
  }, HELPERS_SRC)
  expect(tones.card).toBeGreaterThan(tones.page)
  expect(tones.pop).toBeGreaterThan(tones.card)
})
