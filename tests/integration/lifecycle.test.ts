import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRefreshBatch } from '../../src/refresh/runner'
import { trackingFixture, starterInput } from './tracking-fixture'

describe('data lifecycle: disconnect, account deletion, refresh lock', () => {
  let fixture: Awaited<ReturnType<typeof trackingFixture>>
  let env: any

  beforeEach(async () => {
    fixture = await trackingFixture()
    env = fixture.env
  }, 30_000)

  afterEach(async () => { await fixture.dispose?.() })

  // Every table carrying a workspace_id (matches WORKSPACE_TABLES in settings.ts).
  const ALL_TABLES = ['activity_dismissals','activity_notification_deliveries','character_blogs','character_plan_resources','character_plans','character_quicklinks','characters','feature_suggestions','invites','magic_links','memberships','notification_preferences','partners','push_subscriptions','refresh_cursors','reply_branches','reply_draft_characters','reply_drafts','rp_group_characters','rp_groups','sessions','starter_tags','starter_templates','starters','tags','tumblr_connections','tumblr_oauth_states','activities']

  async function workspaceRows(workspaceId: string): Promise<number> {
    let total = 0
    for (const table of ALL_TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id=?`).bind(workspaceId).first()
      total += row?.n ?? 0
    }
    return total
  }

  it('disconnect wipes tokens, resets cursors, stops cron; keeps threads and other connections', async () => {
    // Give blog-a a starter so there is state to lose, and a cursor row with a prior error.
    const s = await fixture.request('/api/starters', 'POST', starterInput, 'a')
    expect(s.status).toBe(201)
    await env.DB.prepare('INSERT INTO refresh_cursors (workspace_id, character_blog_id, newest_post_timestamp, newest_post_id, last_error, failure_count) VALUES (?,?,?,?,?,?)')
      .bind('a', 'blog-a', '2026-01-01T00:00:00.000Z', '111', 'boom', 2).run()

    // Disconnect connection-a.
    const del = await fixture.request('/api/connections/connection-a', 'DELETE', undefined, 'a')
    expect(del.status).toBe(204)

    // Tokens gone, status disconnected, oauth state cleared.
    const c = await env.DB.prepare('SELECT status,token_encrypted,token_secret_encrypted,account_metadata_json FROM tumblr_connections WHERE id=?').bind('connection-a').first()
    expect(c.status).toBe('disconnected')
    expect(c.token_encrypted).toBe('')
    expect(c.token_secret_encrypted).toBe('')
    expect(c.account_metadata_json).toBe('{}')
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tumblr_oauth_states').first()).n).toBe(0)
    // Cursor fully reset.
    const cur = await env.DB.prepare('SELECT newest_post_timestamp,newest_post_id,last_error,failure_count FROM refresh_cursors WHERE character_blog_id=?').bind('blog-a').first()
    expect(cur.newest_post_timestamp).toBeNull()
    expect(cur.newest_post_id).toBeNull()
    expect(cur.last_error).toBeNull()
    expect(cur.failure_count).toBe(0)

    // Character, starter, and the other connection + its blog survive.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM characters WHERE workspace_id=?').bind('a').first()).n).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM starters').first()).n).toBe(1)
    const c2 = await env.DB.prepare('SELECT status,token_encrypted FROM tumblr_connections WHERE id=?').bind('connection-b').first()
    expect(c2.status).toBe('active')
    expect(c2.token_encrypted).not.toBe('')
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM character_blogs WHERE id=?').bind('blog-b').first()).n).toBe(1)

    // Scheduled refresh: connection-a (disconnected) must never be selected; blog-a cursor untouched.
    await runRefreshBatch(env, new Date('2026-02-02T10:00:00.000Z'), 100, { fetchBudget: 5, runId: 'lock-disc' })
    const mainCursor = await env.DB.prepare('SELECT last_attempt_at FROM refresh_cursors WHERE character_blog_id=?').bind('blog-a').first()
    expect(mainCursor.last_attempt_at).toBeNull()
  })

  it('account deletion (sole member) leaves zero rows in every workspace table and removes the user', async () => {
    const s = await fixture.request('/api/starters', 'POST', starterInput, 'a')
    expect(s.status).toBe(201)
    expect(await workspaceRows('a')).toBeGreaterThan(0)

    // Wrong confirm is rejected.
    expect((await fixture.request('/api/settings/account', 'DELETE', { confirm: 'nope' }, 'a')).status).toBe(400)

    const res = await fixture.request('/api/settings/account', 'DELETE', { confirm: 'DELETE' }, 'a')
    expect(res.status).toBe(204)
    // Cookie cleared.
    expect(res.headers.get('set-cookie')).toMatch(/__Host-threadums_session=|max-age=0/)
    // No rows for the workspace in any table.
    expect(await workspaceRows('a')).toBe(0)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id=?').bind('a').first()).n).toBe(0)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').bind('a').first()).n).toBe(0)
  })

  it('account deletion succeeds for a lived-in account (rows in every linked table; foreign keys enforced)', async () => {
    expect((await fixture.request('/api/starters', 'POST', starterInput, 'a')).status).toBe(201)
    const starter = await env.DB.prepare("SELECT id FROM starters WHERE workspace_id='a'").first()
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reply_branches (id,workspace_id,starter_id,partner_id) VALUES ('branch-x','a',?,'partner-a')").bind(starter.id),
      env.DB.prepare("INSERT INTO activities (id,workspace_id,starter_id,reply_branch_id,type,actor,source) VALUES ('act-x','a',?,'branch-x','reply','me','test')").bind(starter.id),
      env.DB.prepare("INSERT OR IGNORE INTO refresh_cursors (workspace_id,character_blog_id) VALUES ('a','blog-a')"),
      env.DB.prepare("INSERT INTO push_subscriptions (id,workspace_id,user_id,endpoint) VALUES ('push-x','a','a','https://push.example/x')"),
      env.DB.prepare("INSERT INTO notification_preferences (workspace_id,user_id) VALUES ('a','a')"),
      env.DB.prepare("INSERT INTO invites (id,workspace_id,email,token_hash,expires_at) VALUES ('invite-x','a','friend@example.com','hash-x','2099-01-01')"),
      env.DB.prepare("INSERT INTO magic_links (token_hash,email,intent,workspace_id,invite_id,expires_at) VALUES ('ml-x','friend@example.com','accept_invite','a','invite-x','2099-01-01')"),
    ])
    expect((await env.DB.prepare('PRAGMA foreign_keys').first()).foreign_keys).toBe(1)
    const res = await fixture.request('/api/settings/account', 'DELETE', { confirm: 'DELETE' }, 'a')
    expect(res.status, await res.clone().text()).toBe(204)
    expect(await workspaceRows('a')).toBe(0)
  })

  it('account deletion (shared) keeps the other member, clears only this user, and a re-sign-in is empty', async () => {
    // User b joins user a's workspace as a member.
    await env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,'member')").bind('a', 'b').run()

    const s = await fixture.request('/api/starters', 'POST', starterInput, 'a')
    expect(s.status).toBe(201)
    expect(await workspaceRows('a')).toBeGreaterThan(0)

    // User a deletes their account.
    const res = await fixture.request('/api/settings/account', 'DELETE', { confirm: 'DELETE' }, 'a')
    expect(res.status).toBe(204)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').bind('a').first()).n).toBe(0)
    // User a's membership is gone; the workspace + shared data survive.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').bind('a').first()).n).toBe(0)
    expect(await workspaceRows('a')).toBeGreaterThan(0)
    // Other member still sees everything.
    const chars = await fixture.request('/api/characters', 'GET', undefined, 'b')
    expect(chars.status).toBe(200)
    const charList: any[] = await chars.json()
    expect(charList.length).toBe(1)

    // A later sign-in with the same email (user a) starts empty.
    await env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)').bind('a','a@example.com','a','a').run()
    const reUser = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind('a@example.com').first()
    expect(reUser.id).toBe('a')
    // The re-created user has no memberships (fresh).
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').bind('a').first()).n).toBe(0)
  })

  it('an unrelated workspace is untouched by account deletion', async () => {
    const s = await fixture.request('/api/starters', 'POST', starterInput, 'a')
    expect(s.status).toBe(201)
    await fixture.request('/api/settings/account', 'DELETE', { confirm: 'DELETE' }, 'a')

    // workspace-b and user-b are fully intact.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE id=?').bind('b').first()).n).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').bind('b').first()).n).toBe(1)
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=? AND role='owner'").bind('b').first()).n).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM characters WHERE workspace_id=?').bind('b').first()).n).toBe(1)
  })

  it('reconnecting moves only that account’s blogs off the disconnected connection', async () => {
    const { hashToken } = await import('../../src/auth/sessions')
    const { encryptToken } = await import('../../src/tumblr/oauth')
    const cipher = await encryptToken('x', env.TOKEN_ENCRYPTION_KEY)
    // A second (other) Tumblr account in workspace a, also disconnected, with its own blog.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tumblr_connections (id,workspace_id,token_encrypted,token_secret_encrypted,account_metadata_json,status) VALUES ('connection-a2','a','','','{}','disconnected')"),
      env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES ('blog-a2','a','character-a','connection-a2','other.tumblr.com','other')"),
    ])
    expect((await fixture.request('/api/connections/connection-a', 'DELETE', undefined, 'a')).status).toBeLessThan(300)
    const state = 'c'.repeat(64)
    await env.DB.prepare('INSERT INTO tumblr_oauth_states (state_hash,workspace_id,request_token_encrypted,request_secret_encrypted,expires_at) VALUES (?,?,?,?,?)').bind(await hashToken(state), 'a', await encryptToken('rt', env.TOKEN_ENCRYPTION_KEY), cipher, '2999-01-01T00:00:00.000Z').run()
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input instanceof Request ? input.url : input).includes('access_token')
      ? new Response('oauth_token=t&oauth_token_secret=s')
      : Response.json({ response: { user: { blogs: [{ name: 'a' }] } } })) as typeof fetch
    try { expect((await fixture.request(`/api/tumblr/callback?state=${state}&oauth_token=rt&oauth_verifier=v`, 'GET', undefined, 'a')).status).toBe(302) } finally { globalThis.fetch = realFetch }
    const rows = await env.DB.prepare("SELECT cb.id, tc.status FROM character_blogs cb JOIN tumblr_connections tc ON tc.id=cb.tumblr_connection_id WHERE cb.workspace_id='a' ORDER BY cb.id").all()
    expect(rows.results).toEqual([{ id: 'blog-a', status: 'active' }, { id: 'blog-a2', status: 'disconnected' }])
    // The emptied old connection is gone; the other account's disconnected row stays (it still has a blog).
    const ids = (await env.DB.prepare("SELECT id FROM tumblr_connections WHERE workspace_id='a' AND status='disconnected'").all()).results.map((r: any) => r.id)
    expect(ids).toEqual(['connection-a2'])
  })

  it('a Tumblr Allow link started by one user cannot be finished by another user', async () => {
    const { hashToken } = await import('../../src/auth/sessions')
    const { encryptToken } = await import('../../src/tumblr/oauth')
    const state = 'd'.repeat(64)
    await env.DB.prepare('INSERT INTO tumblr_oauth_states (state_hash,workspace_id,request_token_encrypted,request_secret_encrypted,expires_at) VALUES (?,?,?,?,?)').bind(await hashToken(state), 'a', await encryptToken('rt', env.TOKEN_ENCRYPTION_KEY), await encryptToken('x', env.TOKEN_ENCRYPTION_KEY), '2999-01-01T00:00:00.000Z').run()
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM tumblr_connections').first()).n
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('must not reach Tumblr') }) as typeof fetch
    try {
      expect((await fixture.request(`/api/tumblr/callback?state=${state}&oauth_token=rt&oauth_verifier=v`, 'GET', undefined, 'b')).status).toBe(403)
      expect((await fixture.request(`/api/tumblr/callback?state=${state}&oauth_token=rt&oauth_verifier=v`, 'GET', undefined, 'signed-out')).status).toBe(401)
    } finally { globalThis.fetch = realFetch }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tumblr_connections').first()).n).toBe(before)
  })

  it('a second overlapping refresh is a no-op while another run is live', async () => {
    // connection-a is active; a refresh with a given run id grabs the lock.
    const first = await runRefreshBatch(env, new Date('2026-02-02T10:00:00.000Z'), 100, { fetchBudget: 5, runId: 'overlap-1' })
    expect(first.selected).toBeGreaterThanOrEqual(1)
    // The lock row is stamped finished.
    const lock = await env.DB.prepare('SELECT finished_at FROM refresh_runs WHERE id=?').bind('overlap-1').first()
    expect(lock.finished_at).not.toBeNull()

    // A fresh run with a different id works normally (lock released).
    const second = await runRefreshBatch(env, new Date('2026-02-02T10:05:00.000Z'), 100, { fetchBudget: 5, runId: 'overlap-2' })
    expect(second.selected).toBeGreaterThanOrEqual(1)
    const lock2 = await env.DB.prepare('SELECT finished_at FROM refresh_runs WHERE id=?').bind('overlap-2').first()
    expect(lock2.finished_at).not.toBeNull()

    // A concurrent run with the SAME id is a no-op: it sees the live lock.
    // Simulate an in-flight run by inserting an unfinished lock, then re-running.
    await env.DB.prepare('INSERT INTO refresh_runs (id,started_at,finished_at) VALUES (?,?,NULL)').bind('overlap-live', '2026-02-02T10:00:00.000Z').run()
    const blocked = await runRefreshBatch(env, new Date('2026-02-02T10:01:00.000Z'), 100, { fetchBudget: 5, runId: 'overlap-other' })
    expect(blocked.selected).toBe(0)
    expect(blocked.refreshed).toBe(0)
    expect(blocked.fetchesUsed).toBe(0)
  })
})

describe('multi-blog: sideblogs, own posts, thread identity, disconnect isolation', () => {
  let fixture: Awaited<ReturnType<typeof trackingFixture>>
  let env: any

  beforeEach(async () => {
    fixture = await trackingFixture()
    env = fixture.env
    delete (globalThis as any).__tumblrStubNotes
    delete (globalThis as any).__tumblrStubPosts
  }, 30_000)

  afterEach(async () => { await fixture.dispose?.() })

  it('a reply from any of the character\'s assigned blogs counts as their_turn', async () => {
    // Add two sideblogs to character-a on connection-a.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)').bind('blog-a2','a','character-a','connection-a','a2.tumblr.com','Sideblog 2'),
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)').bind('blog-a3','a','character-a','connection-a','a3.tumblr.com','Sideblog 3'),
    ])
    // Create a partner and a starter for character-a.
    const s = await fixture.request('/api/starters', 'POST', {
      characterId: 'character-a', title: 'Multi-blog starter',
      postUrl: 'https://a.tumblr.com/post/9999', description: 'test',
    }, 'a')
    expect(s.status).toBe(201)
    const starter: any = await s.json()
    // Add a partner (b.tumblr.com) and a reply branch to it.
    await env.DB.prepare('INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES (?,?,?,?)')
      .bind('partner-mb','a','b.tumblr.com','Partner mb').run()
    await env.DB.prepare('INSERT INTO reply_branches (id,workspace_id,starter_id,partner_id,status) VALUES (?,?,?,?,?)')
      .bind('branch-1','a',starter.id,'partner-mb','your_turn').run()

    // Stub notes: partner-b reblogs from a (root), then a2.tumblr.com (a sideblog) reblogs from b.
    ;(globalThis as any).__tumblrStubNotes = {
      notes: [
        { type: 'reblog', blog_name: 'b', post_id: 50001, reblog_parent_blog_name: 'a', timestamp: 1738368000 },
        { type: 'reblog', blog_name: 'a2', post_id: 50002, reblog_parent_blog_name: 'b', timestamp: 1738368100 },
      ],
    }
    // Run refresh — the a2 post (own sideblog reblogging from partner) should set their_turn.
    await runRefreshBatch(env, new Date('2026-03-01T12:00:00.000Z'), 100, { fetchBudget: 50, runId: 'multi-own' })
    const branch = await env.DB.prepare('SELECT status FROM reply_branches WHERE id=?').bind('branch-1').first()
    expect(branch.status).toBe('their_turn')
  })

  it('disconnecting one connection does not touch the other connection\'s blogs', async () => {
    // Add a sideblog to connection-b so it has multiple blogs too.
    await env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)')
      .bind('blog-b2','b','character-b','connection-b','b2.tumblr.com','B Sideblog').run()

    // Give both connections starters.
    await fixture.request('/api/starters', 'POST', { characterId: 'character-a', title: 'A starter', postUrl: 'https://a.tumblr.com/post/111', description: 'a' }, 'a')
    await fixture.request('/api/starters', 'POST', { characterId: 'character-b', title: 'B starter', postUrl: 'https://b.tumblr.com/post/222', description: 'b' }, 'b')

    // Set cursors on both.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO refresh_cursors (workspace_id,character_blog_id,newest_post_timestamp,newest_post_id) VALUES (?,?,?,?)').bind('a','blog-a','2026-01-01T00:00:00.000Z','111'),
      env.DB.prepare('INSERT INTO refresh_cursors (workspace_id,character_blog_id,newest_post_timestamp,newest_post_id) VALUES (?,?,?,?)').bind('b','blog-b','2026-01-01T00:00:00.000Z','222'),
    ])

    // Disconnect connection-a.
    const del = await fixture.request('/api/connections/connection-a', 'DELETE', undefined, 'a')
    expect(del.status).toBe(204)

    // Connection-b is untouched: still active, token intact, blog-b2 still assigned.
    const cb = await env.DB.prepare('SELECT status,token_encrypted FROM tumblr_connections WHERE id=?').bind('connection-b').first()
    expect(cb.status).toBe('active')
    expect(cb.token_encrypted).not.toBe('')
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM character_blogs WHERE tumblr_connection_id=?').bind('connection-b').first()).n).toBe(2)

    // blog-b cursor is intact (not reset by connection-a disconnect).
    const curB = await env.DB.prepare('SELECT newest_post_id FROM refresh_cursors WHERE character_blog_id=?').bind('blog-b').first()
    expect(curB.newest_post_id).toBe('222')
  })

  it('two characters sharing one blog are told apart by character tags', async () => {
    // Character-a and character-b both assigned to the same blog 'shared.tumblr.com'
    // on their respective connections, distinguished by character_tag.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label,character_tag) VALUES (?,?,?,?,?,?,?)').bind('blog-shared-a','a','character-a','connection-a','shared.tumblr.com','Shared A','alice'),
      env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label,character_tag) VALUES (?,?,?,?,?,?,?)').bind('blog-shared-b','b','character-b','connection-b','shared.tumblr.com','Shared B','bob'),
    ])
    // Both assignments exist with the same blog but different tags.
    const rows = await env.DB.prepare('SELECT character_id,character_tag,workspace_id FROM character_blogs WHERE blog_identifier=?').bind('shared.tumblr.com').all()
    expect(rows.results.length).toBe(2)
    const tags = rows.results.map((r: any) => r.character_tag).sort()
    expect(tags).toEqual(['alice', 'bob'])
    // Each character only sees their own tag for that blog.
    const aTags = await env.DB.prepare('SELECT character_tag FROM character_blogs WHERE character_id=? AND blog_identifier=?').bind('character-a','shared.tumblr.com').all()
    expect(aTags.results.map((r: any) => r.character_tag)).toEqual(['alice'])
    const bTags = await env.DB.prepare('SELECT character_tag FROM character_blogs WHERE character_id=? AND blog_identifier=?').bind('character-b','shared.tumblr.com').all()
    expect(bTags.results.map((r: any) => r.character_tag)).toEqual(['bob'])
  })
})
