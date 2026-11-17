import { test, type Page } from '@playwright/test'

const LONG_NAME = 'Aurelius-Vermeer-von-Blackwood-III-of-the-House-of-Thunderhold'
const LONG_GROUP = 'The Unnamed Cartographers of the Endless Grey Archipelago'

// Signed-in mock of every endpoint App.tsx + the two pages hit on load.
// /api/inbox must be the inbox shape (object), not a list. Unmatched /api/** → [].
async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = route.request().url()
    const respond = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })

    if (url.includes('/api/auth/session')) return respond({ user: { name: 'Tester' } })
    if (url.includes('/api/tumblr-activity/unread-count')) return respond({ count: 0 })
    if (url.includes('/api/inbox')) return respond({ branches: [], yourTurnCount: 0, overdueDraftCount: 0, dueSoonCount: 0 })
    if (url.includes('/api/starters/options')) return respond({ characters: [], partners: [] })
    if (url.includes('/api/tags')) return respond([])
    if (url.includes('/api/connections')) return respond([])
    if (url.includes('/api/rp-groups')) return respond([])
    if (url.includes('/api/characters/archived')) return respond([])
    if (/\/api\/characters\/[^/]+\/quicklinks$/.test(url)) return respond([])
    if (/\/api\/characters\/[^/]+$/.test(url)) return respond(null, 404)
    if (url.includes('/api/characters')) return respond([
      { id: 'c1', name: LONG_NAME, faceclaim: '', icon: 'puffin', description: 'A very long name that must wrap without breaking the card.', status: 'active', rp_group_id: null, rp_group_name: null, quick_links: 0, quick_link_characters: [] },
      { id: 'c2', name: 'Mira', faceclaim: '', icon: 'cat', description: '', status: 'active', rp_group_id: 'g1', rp_group_name: LONG_GROUP, quick_links: 1, quick_link_characters: [{ id: 'c3', name: 'Juno' }] },
      { id: 'c3', name: 'Juno', faceclaim: '', icon: 'owl', description: '', status: 'archived', rp_group_id: null, rp_group_name: null, quick_links: 0, quick_link_characters: [] },
    ])
    if (url.includes('/api/character-planner')) return respond([
      { id: 'p1', name: LONG_NAME, faceclaim: 'An extremely long faceclaim line for the planner card, repeated: Aurelius Vermeer von Blackwood, third of the house, cartographer of the endless grey archipelago.', notes: '', state: 'idea', iconObjectKey: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', resources: [] },
      { id: 'p2', name: 'Mira', faceclaim: '', notes: '', state: 'developing', iconObjectKey: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', resources: [] },
      { id: 'p3', name: 'Juno', faceclaim: '', notes: '', state: 'ready', iconObjectKey: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', resources: [] },
    ])
    return respond([])
  })
}

// Every element of every .character-card / .planner-card must sit inside the card box (1px tolerance).
async function assertCardsFit(page: Page) {
  const overflow = await page.evaluate(() => {
    const bad: string[] = []
    const TOL = 1
    for (const card of Array.from(document.querySelectorAll<HTMLElement>('.character-card, .planner-card'))) {
      const c = card.getBoundingClientRect()
      for (const el of card.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.left < c.left - TOL || r.top < c.top - TOL || r.right > c.right + TOL || r.bottom > c.bottom + TOL) {
          bad.push(`${card.querySelector('h3')?.textContent ?? card.className} > ${el.tagName}.${el.className}`)
        }
      }
    }
    return bad
  })
  test.expect(overflow).toEqual([])
}

// The sidebar footer (.nav-note) must not intersect the last visible nav link.
async function assertNavFooterClear(page: Page) {
  const overlap = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.primary-nav')
    const note = document.querySelector<HTMLElement>('.nav-note')
    if (!nav || !note) return null // guest (no nav) or no footer: nothing to overlap
    const links = Array.from(nav.querySelectorAll<HTMLElement>(':scope > a')).filter(a => a.offsetParent !== null)
    if (!links.length) return null
    const last = links[links.length - 1].getBoundingClientRect()
    const n = note.getBoundingClientRect()
    const gap = 1
    const intersects = n.left < last.right + gap && n.right > last.left - gap && n.top < last.bottom + gap && n.bottom > last.top - gap
    return intersects ? { lastBottom: Math.round(last.bottom), noteTop: Math.round(n.top) } : null
  })
  test.expect(overlap).toBeNull()
}

// The sidebar footer's own buttons must not cover each other (they share the .nav-note box).
async function assertNavFooterButtonsClear(page: Page) {
  const overlap = await page.evaluate(() => {
    const hint = document.querySelector<HTMLElement>('.shortcut-hint')
    const signOut = document.querySelector<HTMLElement>('.sign-out')
    if (!hint || !signOut) return null
    const h = hint.getBoundingClientRect()
    const s = signOut.getBoundingClientRect()
    const intersects = h.left < s.right && h.right > s.left && h.top < s.bottom && h.bottom > s.top
    return {
      hintVisible: hint.offsetParent !== null && h.width > 0 && h.height > 0,
      signOutVisible: signOut.offsetParent !== null && s.width > 0 && s.height > 0,
      intersects,
    }
  })
  test.expect(overlap?.hintVisible).toBe(true)
  test.expect(overlap?.signOutVisible).toBe(true)
  test.expect(overlap?.intersects).toBe(false)
}

// On wide viewports the planner card's name h3 must have room to actually
// display the (long) name — not be squeezed into a sliver by the avatar/badge.
async function assertPlannerHeadingWidth(page: Page) {
  const width = await page.evaluate(() => {
    const h3 = document.querySelector<HTMLElement>('.planner-card .planner-card-heading h3')
    return h3 ? h3.getBoundingClientRect().width : 0
  })
  test.expect(width).toBeGreaterThanOrEqual(160)
}

const VIEWPORTS = [
  { name: 'laptop-1280', width: 1280, height: 720 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'laptop-1440', width: 1440, height: 900 },
  { name: 'zoom-640', width: 640, height: 360 },
  { name: 'mobile-375', width: 375, height: 812 },
]

for (const viewport of VIEWPORTS) {
  test.describe(`layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const pageName of ['characters', 'planner'] as const) {
      test(`${pageName} fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await mockApi(page)
        await page.goto(`#${pageName === 'planner' ? 'planner' : 'characters'}`)
        // Each page renders a different card class; wait for the one that page owns.
        await page.waitForSelector(pageName === 'planner' ? '.planner-card' : '.character-card', { timeout: 15000 })
        await page.waitForTimeout(300) // let rise animation + layout settle

        const scrollWidth = await page.evaluate(() =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        )
        const innerWidth = await page.evaluate(() => window.innerWidth)
        test.expect(scrollWidth).toBeLessThanOrEqual(innerWidth)

        await assertCardsFit(page)
        await assertNavFooterClear(page)
        if (pageName === 'planner' && viewport.width >= 1024) await assertPlannerHeadingWidth(page)

        await page.screenshot({ path: `test-results/layout/${pageName}-${viewport.width}x${viewport.height}.png` })
      })
    }
  })
}

test.describe('sidebar footer at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } })
  test('sidebar footer buttons do not overlap', async ({ page }) => {
  await mockApi(page)
  await page.goto('#characters')
  await page.waitForSelector('.character-card', { timeout: 15000 })
  await page.waitForTimeout(300)
  await assertNavFooterButtonsClear(page)
})
})
