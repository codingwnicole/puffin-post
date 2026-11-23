import { afterEach, describe, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

const fixtures: Array<Awaited<ReturnType<typeof trackingFixture>>> = []
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose() })

async function fixture() {
  const value = await trackingFixture()
  fixtures.push(value)
  return value
}

function sprintInput(id = crypto.randomUUID()) {
  return {
    id, title: 'Friday reply sprint', kind: 'solo', startedAt: '2026-11-23T18:00:00.000Z',
    endedAt: '2026-11-23T18:15:00.000Z', durationSeconds: 900,
    wordsCredited: 420, repliesCompleted: 3, goalWords: 500, participantCount: 1,
  }
}

describe('writing sprint history and rooms', () => {
  it('saves only aggregate totals and scopes them to the current workspace', async () => {
    const f = await fixture()
    const input = sprintInput()
    const saved = await f.request('/api/sprints', 'POST', input, 'a')
    expect(saved.status).toBe(201)
    const row = await saved.json() as Record<string, unknown>
    expect(row.wordsCredited).toBe(420)
    expect(row.repliesCompleted).toBe(3)
    expect(row).not.toHaveProperty('text')
    expect(row).not.toHaveProperty('segments')

    const aList = await (await f.request('/api/sprints', 'GET', undefined, 'a')).json() as Array<{ id: string }>
    const bList = await (await f.request('/api/sprints', 'GET', undefined, 'b')).json() as Array<{ id: string }>
    expect(aList.map(item => item.id)).toContain(input.id)
    expect(bList.map(item => item.id)).not.toContain(input.id)
  })

  it('makes result retries idempotent and rejects prose payloads or changed duplicates', async () => {
    const f = await fixture()
    const input = sprintInput()
    expect((await f.request('/api/sprints', 'POST', input)).status).toBe(201)
    expect((await f.request('/api/sprints', 'POST', input)).status).toBe(200)
    expect((await f.request('/api/sprints', 'POST', { ...input, wordsCredited: 421 })).status).toBe(409)
    expect((await f.request('/api/sprints', 'POST', { ...sprintInput(), replyText: 'private reply prose' })).status).toBe(400)
  })

  it('creates a password-protected room, validates guests, and enforces capacity', async () => {
    const f = await fixture()
    const createdResponse = await f.request('/api/sprint-rooms', 'POST', {
      name: 'Quiet writing room', hostName: 'Host', durationSeconds: 900,
      goalWords: 600, participantLimit: 2, password: 'room-secret',
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as {
      roomId: string; inviteToken: string; participantToken: string; participantId: string
      state: { participants: Array<{ name: string }>; [key: string]: unknown }
    }
    expect(created.state.participants.map(person => person.name)).toEqual(['Host'])
    expect(JSON.stringify(created.state)).not.toContain('room-secret')
    expect(JSON.stringify(created.state)).not.toContain(created.inviteToken)
    expect(JSON.stringify(created.state)).not.toContain(created.participantToken)

    const endpoint = `/api/sprint-rooms/${created.roomId}/join`
    expect((await f.request(endpoint, 'POST', { inviteToken: created.inviteToken, displayName: 'Guest', password: 'wrong' })).status).toBe(403)
    const joinedResponse = await f.request(endpoint, 'POST', { inviteToken: created.inviteToken, displayName: 'Guest', password: 'room-secret' })
    expect(joinedResponse.status).toBe(200)
    const joined = await joinedResponse.json() as { participantId: string; participantToken: string; state: { participants: Array<{ name: string }> } }
    expect(joined.participantId).not.toBe(created.participantId)
    expect(joined.state.participants.map(person => person.name)).toEqual(['Host', 'Guest'])

    expect((await f.request(endpoint, 'POST', { inviteToken: created.inviteToken, displayName: 'Third', password: 'room-secret' })).status).toBe(409)
    const rejoined = await f.request(endpoint, 'POST', { participantToken: joined.participantToken })
    expect(rejoined.status).toBe(200)
    expect((await rejoined.json() as { participantId: string }).participantId).toBe(joined.participantId)
  })
})
