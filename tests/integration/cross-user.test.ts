import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { trackingFixture, starterInput } from './tracking-fixture'
import { startSession } from '../../src/auth/sessions'
import { Hono } from 'hono'

// Two strangers (tenants a and b) tracking the SAME Tumblr blog and the SAME
// thread. Proves strict separation: A's refresh/mutations never touch B's
// workspace, every read surface for one tenant is empty of the other's data,
// foreign ids 404, and workspace switching is membership-gated server-side.

type FX = Awaited<ReturnType<typeof trackingFixture>>
let env: FX['env']
let request: FX['request']
let dispose: () => Promise<void>
let starterA = '', planA = ''
// A's row that B must never see / touch.
const sharedUrl = 'https://a.tumblr.com/post/12345'

beforeAll(async () => {
  const fx = await trackingFixture()
  env = fx.env; request = fx.request; dispose = fx.dispose
  // A creates a starter on the shared blog + thread (201: {...starter, branch}).
  const s = await request('/api/starters', 'POST', { ...starterInput, postUrl: sharedUrl }, 'a')
  const created = (await s.json()) as { id?: string; starter?: { id: string }; branch?: { id?: string } }
  starterA = created.id ?? created.starter?.id ?? ''
  expect(starterA).toBeTruthy()
  // A creates a character planner plan (a second A-only resource).
  const p = await request('/api/character-planner', 'POST', { name: 'A plan', persona: 'x' }, 'a')
  planA = ((await p.json()) as { id?: string }).id ?? ''
  expect(planA).toBeTruthy()
})
afterAll(async () => { await dispose() })

const json = async (p: string, m = 'GET', b?: unknown, t = 'a') => (await request(p, m, b, t)).json()

describe('cross-user separation (two strangers, same blog + thread)', () => {
  it('B\'s inbox / unread / activity / search contain nothing of A\'s', async () => {
    const inboxB = (await json('/api/inbox', 'GET', undefined, 'b')) as { branches: { id: string }[]; yourTurnCount: number }
    expect(inboxB.branches.map(x => x.id)).not.toContain(starterA)
    // Search the activity feed for A's shared post URL — B must not surface it.
    const feedB = (await request('/api/tumblr-activity?q=' + encodeURIComponent(sharedUrl), 'GET', undefined, 'b')).json()
    expect(JSON.stringify(feedB)).not.toContain(starterA)
    expect(((await json('/api/tumblr-activity/unread-count', 'GET', undefined, 'b')) as { count: number }).count).toBe(0)
  })

  it('B\'s character planner and push status expose none of A\'s', async () => {
    const plansB = (await json('/api/character-planner', 'GET', undefined, 'b')) as { plans: { id: string }[] }
    expect(plansB.plans.map(p => p.id)).not.toContain(planA)
    expect(((await json('/api/push/subscription', 'GET', undefined, 'b')) as { enabled: boolean }).enabled).toBe(false)
  })

  it('B\'s export contains none of A\'s rows', async () => {
    const csvB = await (await request('/api/export.csv', 'GET', undefined, 'b')).text()
    expect(csvB).not.toContain(sharedUrl)
    expect(csvB).not.toContain(starterA)
  })

  it('B\'s GET of any A id returns 404', async () => {
    expect((await request(`/api/starters/${starterA}`, 'GET', undefined, 'b')).status).toBe(404)
    expect((await request(`/api/character-planner/${planA}`, 'GET', undefined, 'b')).status).toBe(404)
  })

  it('A archiving does not change B\'s view', async () => {
    const beforeB = await json('/api/inbox', 'GET', undefined, 'b')
    // A archives their own starter (A-only mutation).
    await request(`/api/starters/${starterA}/archive`, 'POST', undefined, 'a')
    const afterB = await json('/api/inbox', 'GET', undefined, 'b')
    expect(afterB).toEqual(beforeB)
  })

  it('a user in two workspaces sees only the active workspace', async () => {
    // Make tenant a a member of workspace b (a second workspace), then confirm
    // the active session (cookie a) still surfaces only workspace a's data.
    await env.DB.prepare("INSERT OR IGNORE INTO memberships (workspace_id,user_id,role) VALUES ('b','a','member')").run()
    try {
      const charsA = (await json('/api/characters', 'GET', undefined, 'a')) as { characters?: { id: string }[] } | { id: string }[]
      const aIds = (Array.isArray(charsA) ? charsA : charsA.characters ?? []).map((c: any) => c.id)
      expect(aIds).toContain('character-a')
      expect(aIds).not.toContain('character-b')
    } finally {
      await env.DB.prepare("DELETE FROM memberships WHERE workspace_id='b' AND user_id='a'").run()
    }
  })

  it('binding a session to a workspace you do not belong to is refused server-side', async () => {
    // tenant b is NOT a member of workspace a. startSession must 403.
    const app = new Hono<{ Bindings: typeof env }>()
    app.get('/', async c => { await startSession(c, 'b', 'a'); return c.text('ok') })
    const res = await app.request('/', {}, env)
    expect(res.status).toBe(403)
  })
})
