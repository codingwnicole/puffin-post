// Redesign data-integrity check (real Worker + local D1, no mocks).
// Seeds a workspace that uses every kind of data a writer has (characters, full trading cards, RP sections,
// quicklinks, moodboard, tracked threads with every branch field, labels, Parking lot drafts, planner ideas,
// public sharing), snapshots it through the API, walks every redesigned page checking the data is shown,
// opens and saves editors without changes, and finally proves the stored data is byte-for-byte unchanged.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createSignedInUser } from './auth-fixture'

const APP = 'http://localhost:5173'
test.use({ baseURL: APP })
test.setTimeout(120_000)

const CARD = {
  theme: 'vamp', symbol: 'moon', nickname: 'Nora Bellamy', age: 'thirty-four', birthdate: '1694', quote: 'People have beautiful things to say about you, but you must die first.',
  song: 'The Garden', artist: 'The Crane Wives', favoriteColor: '#7a3b4f', facts: ['ambidextrous', 'hums sea shanties', 'collects maps', 'hates rain', 'owes three debts'],
  likes: 'maps, lanterns, honest weather', dislikes: 'pity, calm seas', notes: 'keeps the ledger secret', playlistUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  boardUrl: 'https://www.pinterest.com/nora/ledger-board/', tracklist: ['The Garden', 'Keeper'],
}

async function ok<T>(response: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await response
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true)
  return (r.status() === 204 ? null : await r.json()) as T
}

// Everything a writer stores, read back through the API. Timestamps that the server bumps on reads are dropped.
async function snapshot(api: APIRequestContext, ids: { characters: string[]; starters: string[] }) {
  const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v) => (/^(updatedAt|lastSeenAt|lastViewedAt)$/.test(key) ? undefined : v)))
  const characters = await ok<unknown[]>(api.get('/api/characters'))
  const perCharacter = await Promise.all(ids.characters.map(async id => ({
    id,
    quicklinks: await ok<unknown>(api.get(`/api/characters/${id}/quicklinks`)),
    moodboard: await ok<unknown>(api.get(`/api/characters/${id}/moodboard`)),
    share: await ok<unknown>(api.get(`/api/characters/${id}/share`)),
  })))
  const perStarter = await Promise.all(ids.starters.map(async id => ({ id, detail: await ok<unknown>(api.get(`/api/starters/${id}`)), tags: await ok<unknown>(api.get(`/api/tags/starters/${id}`)) })))
  return strip({
    characters, perCharacter, perStarter,
    inbox: await ok<unknown>(api.get('/api/inbox?includeArchived=true&limit=100')),
    groups: await ok<unknown>(api.get('/api/rp-groups')),
    drafts: await ok<unknown>(api.get('/api/reply-drafts')),
    plans: await ok<unknown>(api.get('/api/character-planner')),
    tags: await ok<unknown>(api.get('/api/tags')),
  })
}

test('existing data survives the redesign: every page shows it and nothing is changed by opening or saving', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: APP, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.7.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), origin: APP } })
  const page = await ctx.newPage()
  await page.goto('/#dashboard')
  await createSignedInUser(page)
  const api = page.request

  // ---------- seed a realistic workspace ----------
  const group = await ok<{ id: string }>(api.post('/api/rp-groups', { data: { name: 'Tortuga Harbor' } }))
  const nora = await ok<{ id: string }>(api.post('/api/characters', { data: { name: 'Nora' } }))
  const hip = await ok<{ id: string }>(api.post('/api/characters', { data: { name: 'Hippolyte' } }))
  await ok(api.post(`/api/rp-groups/${group.id}/characters`, { data: { characterId: nora.id } }))
  await ok(api.put(`/api/characters/${nora.id}/card`, { data: CARD }))
  await ok(api.post(`/api/characters/${nora.id}/quicklinks`, { data: { label: 'Gif pack', url: 'https://example.com/gifs' } }))
  await ok(api.post(`/api/characters/${nora.id}/moodboard/pin`, { data: { url: 'https://www.pinterest.com/pin/987654321098/' } }))
  const share = await ok<{ slug: string }>(api.put(`/api/characters/${nora.id}/share`, { data: { style: 'card', showMoodboard: true, showPlaylist: true, showStats: true, indexable: false } }))
  const s1 = await ok<{ id: string }>(api.post('/api/starters', { data: { characterId: nora.id, groupId: group.id, title: 'nora × Catherine', partnerName: 'Catherine', description: 'She only came to this part of the island to free one of her own.' } }))
  const s2 = await ok<{ id: string }>(api.post('/api/starters', { data: { characterId: nora.id, groupId: group.id, title: 'nora × Zohra — The Pit', partnerName: 'Zohra', description: 'Watching a fight in the Pit.' } }))
  const s3 = await ok<{ id: string }>(api.post('/api/starters', { data: { characterId: hip.id, title: 'hippolyte × ishani', partnerName: 'Ishani', description: 'At the shop in the Shambles.' } }))
  const detail = await ok<{ branches: { id: string }[] }>(api.get(`/api/starters/${s2.id}`))
  const branchId = detail.branches[0].id
  await ok(api.patch(`/api/branches/${branchId}`, { data: { status: 'their_turn', notes: 'Remember the knife.', userRecap: 'Next: Zohra spots the bet.', nextCheckAt: '2026-12-01T09:00:00.000Z', partnerMuses: ['Zohra', 'Mateo'] } }))
  const tag = await ok<{ id: string }>(api.post('/api/tags', { data: { label: 'w. elinor 01' } }))
  await ok(api.post(`/api/tags/${tag.id}/starters/${s1.id}`))
  await ok(api.post('/api/reply-drafts', { data: { title: 'Reply to Diana', notes: 'Half written, keep the rain.', purpose: 'reply' } }))
  await ok(api.post('/api/reply-drafts', { data: { title: 'Plot with lavendarseagreen', notes: 'Who broke out of the Brig?', purpose: 'plotting' } }))
  await ok(api.post('/api/character-planner', { data: { name: 'Odile Fenn', faceclaim: 'harbor smuggler', notes: 'needs a hook' } }))

  const ids = { characters: [nora.id, hip.id], starters: [s1.id, s2.id, s3.id] }
  const before = await snapshot(api, ids)

  // Any write the UI sends while we only look must be reported.
  const writes: string[] = []
  page.on('request', request => { const m = request.method(); if (m !== 'GET' && m !== 'HEAD' && request.url().includes('/api/') && !request.url().includes('/client-errors') && !request.url().includes('/mark-seen')) writes.push(`${m} ${new URL(request.url()).pathname}`) })

  // ---------- Dashboard: sections, threads, premises, labels, branch fields ----------
  await page.goto('/#dashboard'); await page.reload()
  await expect(page.getByRole('heading', { name: 'Tortuga Harbor' })).toBeVisible({ timeout: 15000 })
  for (const text of ['nora × Catherine', 'nora × Zohra — The Pit', 'hippolyte × ishani', 'She only came to this part of the island to free one of her own.', 'Watching a fight in the Pit.']) await expect(page.locator('article.branch-card').getByText(text, { exact: true })).toBeVisible()
  const zohra = page.locator('article.branch-card').filter({ hasText: 'nora × Zohra' })
  await expect(zohra.locator('.turn-badge')).toHaveText('Their turn')
  await zohra.getByRole('button', { name: /Show scene details/ }).click()
  const drawer = page.getByRole('dialog', { name: 'nora × Zohra — The Pit' })
  await expect(drawer.getByLabel('Thread notes')).toHaveValue('Remember the knife.')
  await expect(drawer.getByLabel('Your recap / next step')).toHaveValue('Next: Zohra spots the bet.')
  await expect(drawer.getByLabel('Partner muse names')).toHaveValue('Zohra, Mateo')
  await expect(drawer.getByLabel('Reminder to check back')).toHaveValue('2026-12-01')
  await expect(drawer.getByLabel('Scene premise')).toHaveValue('Watching a fight in the Pit.')
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  const catherine = page.locator('article.branch-card').filter({ hasText: 'nora × Catherine' })
  await catherine.getByRole('button', { name: /Show scene details/ }).click()
  await expect(page.getByRole('dialog', { name: 'nora × Catherine' }).getByText('w. elinor 01')).toBeVisible()
  await page.keyboard.press('Escape')

  // ---------- Characters: details (icons, quicklinks, sections) and cards ----------
  await page.goto('/#characters'); await page.reload()
  await expect(page.getByRole('link', { name: 'Gif pack' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Hippolyte', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  const noraTile = page.locator('.tcard-tile').filter({ hasText: 'Nora Bellamy' })
  await expect(noraTile.locator('.tcard')).toHaveAttribute('data-theme-id', 'vamp')
  await expect(noraTile).toContainText('People have beautiful things to say about') // the card SVG wraps the quote onto lines

  // Open the editor and save without touching anything: the stored card must not change.
  await noraTile.getByRole('button', { name: /Edit card/ }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Save card' }) })
  await expect(editor.getByLabel('Name on card')).toHaveValue('Nora Bellamy')
  await expect(editor.getByLabel('Quote')).toHaveValue(CARD.quote)
  await editor.getByRole('tab', { name: 'Back' }).click()
  for (let i = 0; i < 5; i++) await expect(editor.getByLabel(`Fun fact ${i + 1}`)).toHaveValue(CARD.facts[i])
  await expect(editor.getByLabel('Likes', { exact: true })).toHaveValue(CARD.likes)
  await expect(editor.getByLabel('Dislikes', { exact: true })).toHaveValue(CARD.dislikes)
  await editor.getByRole('tab', { name: 'Playlist & board' }).click()
  await expect(editor.getByLabel('Playlist link')).toHaveValue(CARD.playlistUrl)
  await expect(editor.getByLabel('Pinterest board', { exact: true })).toHaveValue(CARD.boardUrl)
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/characters/${nora.id}/card`) && r.request().method() === 'PUT')
  await editor.getByRole('button', { name: 'Save card' }).click()
  expect((await saved).ok()).toBe(true)
  await expect(editor).toBeHidden()

  // ---------- Profile: moodboard, facts, tracklist, board, playlist ----------
  await page.goto(`/#character/${nora.id}`); await page.reload()
  await expect(page.getByRole('heading', { name: 'Nora', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('1 of 12')).toBeVisible()
  await expect(page.locator('.profile-tracklist li')).toHaveText(CARD.tracklist)
  await expect(page.locator('.profile-board')).toHaveAttribute('href', CARD.boardUrl)
  for (const fact of CARD.facts) await expect(page.getByText(fact, { exact: true }).first()).toBeVisible()

  // ---------- Parking lot and planner ----------
  await page.goto('/#parking-lot'); await page.reload()
  await expect(page.getByRole('heading', { name: 'Reply to Diana', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Plot with lavendarseagreen', exact: true })).toBeVisible()
  await page.goto('/#planner'); await page.reload()
  await expect(page.getByText('Odile Fenn').first()).toBeVisible({ timeout: 15000 })

  // ---------- Public profile page ----------
  const pub = await ctx.newPage()
  await pub.goto(`/c/${share.slug}`)
  for (const text of ['Nora Bellamy', CARD.likes, CARD.dislikes, CARD.facts[0], 'The Garden']) await expect(pub.getByText(text).first()).toBeVisible()
  await pub.close()

  // ---------- nothing changed ----------
  // The only write allowed is the explicit "Save card" above, which must have stored the same card.
  expect(writes.filter(w => w !== `PUT /api/characters/${nora.id}/card`)).toEqual([])
  const after = await snapshot(api, ids)
  expect(after).toEqual(before)
  await ctx.close()
})
