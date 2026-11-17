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


// The client's postText collapses newlines to spaces, so the header is fed on
// one logical line and each field stops at the NEXT header label (when:) —
// exactly the stop a line break would provide in real RP headers.
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
