import { afterEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>> | undefined
afterEach(async () => { await fixture?.dispose(); fixture = undefined })

it('persists notification controls without deleting working push subscriptions', async () => {
  fixture = await trackingFixture()
  await fixture.env.DB.prepare('INSERT INTO push_subscriptions (id,workspace_id,user_id,endpoint) VALUES (?,?,?,?)')
    .bind('push-a', 'a', 'a', 'https://push.example.net/subscription/a').run()
  const initial = await (await fixture.request('/api/notifications/preferences')).json() as any
  expect(initial).toMatchObject({ pushEnabled: true, pushDevices: 1, emailAvailable: false })
  const saved = await fixture.request('/api/notifications/preferences', 'PUT', {
    inAppEnabled: false, pushEnabled: true, globalMuted: true,
    notifyReplies: false, notifyReminders: true, notifyPossibleThreads: false, notifyActivityRequirements: true,
    timezone: 'America/Chicago', quietStartLocal: 22, quietEndLocal: 7,
  })
  expect(saved.status).toBe(200)
  expect((await (await fixture.request('/api/notifications/preferences')).json() as any)).toMatchObject({
    pushEnabled: true, pushDevices: 1, inAppEnabled: false, notifyReplies: false, notifyPossibleThreads: false,
    globalMuted: true, timezone: 'America/Chicago', quietStartLocal: 22, quietEndLocal: 7,
  })
  expect((await fixture.request('/api/notifications/preferences', 'PUT', {
    inAppEnabled: true, pushEnabled: true, globalMuted: false,
    notifyReplies: true, notifyReminders: true, notifyPossibleThreads: true, notifyActivityRequirements: true,
    timezone: 'Not/AZone', quietStartLocal: null, quietEndLocal: null,
  })).status).toBe(400)
  expect((await (await fixture.request('/api/notifications/preferences', 'GET', undefined, 'b')).json() as any).pushDevices).toBe(0)
})

it('keeps activity requirements scoped and labels manual logs as manual', async () => {
  fixture = await trackingFixture()
  const groupResponse = await fixture.request('/api/rp-groups', 'POST', { name: 'Seven Day RP' })
  const group = await groupResponse.json() as { id: string }
  await fixture.request(`/api/rp-groups/${group.id}/characters`, 'POST', { characterId: 'character-a' })
  const requirement = {
    groupId: group.id, scope: 'character', characterId: 'character-a', blogIdentifier: null,
    intervalDays: 7, reminderBeforeHours: 24, reminderDue: true, reminderOverdue: true,
    graceHours: 0, enabled: true, allowManual: false, timezone: 'America/Chicago',
  }
  const created = await fixture.request('/api/activity-requirements', 'POST', requirement)
  expect(created.status).toBe(201)
  const id = (await created.json() as { id: string }).id
  expect((await fixture.request(`/api/activity-requirements/${id}/manual`, 'POST', { activityAt: '2026-11-25T12:00:00.000Z' })).status).toBe(403)
  const updated = await fixture.request('/api/activity-requirements', 'POST', { ...requirement, id, allowManual: true })
  expect(updated.status, await updated.clone().text()).toBe(200)
  expect((await fixture.request(`/api/activity-requirements/${id}/manual`, 'POST', { activityAt: '2026-11-25T12:00:00.000Z', note: 'posted on Tumblr' })).status).toBe(201)
  const overview = await (await fixture.request('/api/activity-requirements')).json() as any
  expect(overview.requirements[0]).toMatchObject({ id, intervalDays: 7, timezone: 'America/Chicago', lastActivitySource: 'manual' })
  const otherWorkspace = await (await fixture.request('/api/activity-requirements', 'GET', undefined, 'b')).json() as any
  expect(otherWorkspace.requirements).toHaveLength(0)
})

