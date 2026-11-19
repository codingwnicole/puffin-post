import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>

function stubPost(key: string, post: Record<string, unknown>) {
  const g = globalThis as any
  g.__tumblrStubPosts = g.__tumblrStubPosts ?? {}
  g.__tumblrStubPosts[key] = post
}

async function resolveTitle(postUrl: string) {
  const res = await fixture.request('/api/starters/resolve', 'POST', { characterId: 'character-a', postUrl })
  expect(res.status).toBe(200)
  const body = await res.json() as { suggestedTitle?: string }
  return body.suggestedTitle ?? ''
}

beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => {
  await fixture?.dispose()
  delete (globalThis as any).__tumblrStubPosts
})


// Each field stops at the next header label (when:) or the end of its text block.
it('stops who/where at the next label, strips @-mentions and "ft.", keeps the title short', async () => {
  const body = 'The rain had not stopped for three days, and the lighthouse beam cut through it every forty seconds until someone finally came down the cliff road carrying a lamp that was far too bright for a night this wet, and Nora held the door open without a single word because she already knew what the letter on the table would say, and the whole town could hear it even though nobody spoke, and the gulls went quiet one by one as the boat slipped past the breakwater into the dark water.'
  stubPost('a:12345', { trail: [{ content: [{ text: `who: @partner ft. Nora\nwhere: the lighthouse\nwhen: night\n\n${body}` }] }] })
  const title = await resolveTitle('https://a.tumblr.com/post/12345')
  expect(title).toBe('Character a × Nora — the lighthouse')
  expect(title.length).toBeLessThanOrEqual(120)
})

// A 300+ char single-line where value with no labels or line breaks to stop it
// must be truncated at the 60-char word boundary, so the whole title stays ≤120.
it('caps a 300-char where line so the whole suggested title stays under 120 chars', async () => {
  const where = 'the cliff road where the salt wind never stopped and the light turned every forty seconds all through the worst of the storm and nobody in the town slept for a single night because they all heard the bell and none of them dared to go and see what it meant for them'
  expect(where.length).toBeGreaterThan(250)
  stubPost('a:11111', { trail: [{ content: [{ text: `where: ${where}` }] }] })
  const title = await resolveTitle('https://a.tumblr.com/post/11111')
  expect(title.length).toBeLessThanOrEqual(120)
  // The word-boundary cap means the truncated where field ends with an ellipsis.
  expect(title.endsWith('…')).toBe(true)
})

async function resolveFull(postUrl: string) {
  const res = await fixture.request('/api/starters/resolve', 'POST', { characterId: 'character-a', postUrl })
  expect(res.status).toBe(200)
  return await res.json() as { suggestedTitle?: string; summary?: string }
}

// Real shape from a beta tester's thread: the partner's header names the USER's muse ("Who: @you ft. <your muse>"),
// the partner's own muse is only in their tags, and the user's reblog has a trimmed trail.
it('a header naming your own muse is not your partner; the partner muse comes from their tags; the summary is the setup', async () => {
  stubPost('lav:900', { tags: ['chayton threads', 'convo: chayton and character a'], content: [
    { text: 'Who: @a ft. Character a' }, { text: 'Where: The Brig, sneaking to where Character a is imprisoned' },
    { text: 'The Crown was always on the tail of the crew. Nobody on the ship slept that night. The rest of the story goes on.' }] })
  stubPost('a:901', { reblogged_root_id: '900', reblogged_root_name: 'lav', content: [{ text: 'character a follows chayton into the dark.' }],
    trail: [{ blog: { name: 'lav' }, post: { id: '899' }, content: [{ text: 'chayton turned back for a moment.' }] }] })
  const found = await resolveFull('https://a.tumblr.com/post/901')
  expect(found.suggestedTitle).toMatch(/^Character a × Chayton — The Brig/)
  expect(found.suggestedTitle).not.toMatch(/Character a × Character a/)
  expect(found.summary).toBe('The Brig, sneaking to where Character a is imprisoned. The Crown was always on the tail of the crew.')
})

it('"closed starter for @you (your muse)" never makes a title with your muse twice, and its header stays out of the summary', async () => {
  stubPost('stx:800', { tags: ['w. character a 01'], content: [
    { text: 'closed starter for @a (character a)' }, { text: 'the sun is just setting on the sixth day at the docks. gulls circle overhead.' }] })
  stubPost('a:801', { reblogged_root_id: '800', reblogged_root_name: 'stx', content: [{ text: 'a reply.' }], trail: [{ blog: { name: 'stx' }, post: { id: '799' }, content: [{ text: 'their reply.' }] }] })
  const found = await resolveFull('https://a.tumblr.com/post/801')
  expect(found.suggestedTitle).not.toMatch(/Character a × Character a/i)
  expect(found.summary).toBe('the sun is just setting on the sixth day at the docks. gulls circle overhead.')
})

it('with no header or tag naming the partner muse, the partner\'s own prose supplies it', async () => {
  stubPost('stx:700', { tags: ['w. character a 01'], content: [{ text: 'closed starter for @a (character a)' }, { text: 'the sun is just setting at the docks. mateo waits by the rail.' }] })
  stubPost('a:701', { reblogged_root_id: '700', reblogged_root_name: 'stx', content: [{ text: 'relief at seeing mateo washes over him.' }],
    trail: [{ blog: { name: 'stx' }, post: { id: '699' }, content: [{ text: 'mateo recognizes him by voice. he steps closer.' }] }] })
  const found = await resolveFull('https://a.tumblr.com/post/701')
  expect(found.suggestedTitle).toBe('Character a × Mateo')
})
