import { afterEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>> | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

it('keeps profile drafts private and publishes only enabled modules and explicitly public quiz results', async () => {
  fixture = await trackingFixture()
  const profile = { biography: { enabled: true, text: 'Approved public biography.' }, quizzes: { enabled: true } }
  expect((await fixture.request('/api/character-profiles/character-a/draft', 'PUT', profile)).status).toBe(200)
  expect((await fixture.request('/api/character-profiles/character-a', 'GET', undefined, 'b')).status).toBe(404)

  const sourceResponse = await fixture.request('/api/character-profiles/sources', 'POST', {
    title: 'A quiz', sourceUrl: 'https://example.com/quiz#results', category: 'alignment', tags: ['fantasy'],
  })
  expect(sourceResponse.status).toBe(201)
  const source = await sourceResponse.json() as { id: string; sourceUrl: string }
  expect(source.sourceUrl).toBe('https://example.com/quiz')
  const duplicate = await fixture.request('/api/character-profiles/sources', 'POST', {
    title: 'Same quiz', sourceUrl: 'https://example.com/quiz', tags: [],
  })
  expect((await duplicate.json() as { id: string; reused: boolean })).toMatchObject({ id: source.id, reused: true })
  expect((await fixture.request('/api/character-profiles/sources', 'POST', {
    title: 'Unsafe', sourceUrl: 'https://127.0.0.1/private', tags: [],
  })).status).toBe(400)

  const resultPayload = { quizSourceId: source.id, resultTitle: 'The Lantern', resultText: 'Public result text.', notes: 'private note secret', completedAt: '2026-11-24T12:00:00.000Z', visibility: 'public' }
  const publicResult = await fixture.request('/api/character-profiles/character-a/quizzes', 'POST', resultPayload)
  expect(publicResult.status).toBe(201)
  const privateResult = await fixture.request('/api/character-profiles/character-a/quizzes', 'POST', { ...resultPayload, resultTitle: 'Private result', resultText: 'private result secret', visibility: 'private' })
  expect(privateResult.status).toBe(201)
  const publicId = (await publicResult.json() as { id: string }).id
  expect((await fixture.request(`/api/character-profiles/character-b/quizzes/${publicId}`, 'PUT', resultPayload, 'b')).status).toBe(404)

  const publish = await fixture.request('/api/character-profiles/character-a/publish', 'POST')
  expect(publish.status).toBe(201)
  const share = await publish.json() as { url: string }
  const slug = new URL(share.url).pathname.split('/').pop()
  const draftOnly = { ...profile, biography: { enabled: true, text: 'Private draft change.' } }
  expect((await fixture.request('/api/character-profiles/character-a/draft', 'PUT', draftOnly)).status).toBe(200)
  const page = await fixture.request(`/c/${slug}`)
  const html = await page.text()
  expect(page.status).toBe(200)
  expect(html).toContain('Approved public biography.')
  expect(html).toContain('Public result text.')
  expect(html).not.toContain('Private draft change.')
  expect(html).not.toContain('private note secret')
  expect(html).not.toContain('private result secret')
})

