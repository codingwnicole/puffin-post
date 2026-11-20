import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { setCookie } from 'hono/cookie'
import type { Env } from '../worker'
import { requireWorkspace, requireSession } from '../auth/sessions'

const COOKIE = '__Host-threadums_session'

// Every table that carries a workspace_id, children before the parents they point at. Live D1
// enforces foreign keys, so a parent deleted before its children fails the whole batch (nothing is
// deleted). Keep in sync with migrations: a new workspace table goes above everything it references.
// The lived-in account test in tests/integration/lifecycle.test.ts catches a wrong order.
const WORKSPACE_TABLES = [
  'activities',                        // -> starters, reply_branches
  'starter_tags',                      // -> starters, tags
  'reply_draft_characters',            // -> reply_drafts, characters
  'reply_drafts',                      // -> characters, partners, reply_branches
  'reply_branches',                    // -> starters, partners
  'starters',                          // -> characters
  'refresh_cursors',                   // -> character_blogs
  'character_blogs',                   // -> characters, tumblr_connections
  'character_shares','character_quicklinks','character_moodboard_items','rp_group_characters', // -> characters (rp_group_characters also -> rp_groups)
  'rp_groups','partners','tags','tumblr_connections','tumblr_oauth_states','starter_templates',
  'activity_dismissals','activity_notification_deliveries',
  'character_plan_resources','character_plans','feature_suggestions',
  'characters',
  'push_subscriptions','notification_preferences', // -> memberships
  'sessions',
  'magic_links',                       // -> invites
  'invites',
  'memberships',
] as const

// Per-user rows inside a shared workspace that belong to the leaving member only.
const USER_TABLES = ['memberships','notification_preferences','push_subscriptions'] as const

export function settingsRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const [characters, connections, lastSuccess, latestFailure, connectionSync] = await Promise.all([
      scope.db.prepare('SELECT id,name,state FROM characters WHERE workspace_id=? ORDER BY name').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,status,created_at AS createdAt FROM tumblr_connections WHERE workspace_id=? ORDER BY created_at DESC').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT last_successful_refresh_at AS value FROM refresh_cursors WHERE workspace_id=? AND last_successful_refresh_at IS NOT NULL ORDER BY last_successful_refresh_at DESC LIMIT 1').bind(scope.workspaceId).first<{value:string}>(),
      scope.db.prepare('SELECT last_error AS error,last_attempt_at AS attemptedAt FROM refresh_cursors WHERE workspace_id=? AND last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1').bind(scope.workspaceId).first<{error:string;attemptedAt:string}>(),
      scope.db.prepare(`
        SELECT tc.id AS connectionId,
          (SELECT MAX(rc.last_successful_refresh_at) FROM refresh_cursors rc JOIN character_blogs cb ON rc.character_blog_id=cb.id WHERE cb.workspace_id=tc.workspace_id AND cb.tumblr_connection_id=tc.id) AS lastSynced,
          (SELECT rc.last_error FROM refresh_cursors rc JOIN character_blogs cb ON rc.character_blog_id=cb.id WHERE cb.workspace_id=tc.workspace_id AND cb.tumblr_connection_id=tc.id AND rc.last_error IS NOT NULL ORDER BY rc.last_attempt_at DESC LIMIT 1) AS lastError,
          (SELECT rc.last_attempt_at FROM refresh_cursors rc JOIN character_blogs cb ON rc.character_blog_id=cb.id WHERE cb.workspace_id=tc.workspace_id AND cb.tumblr_connection_id=tc.id AND rc.last_error IS NOT NULL ORDER BY rc.last_attempt_at DESC LIMIT 1) AS lastErrorAt
        FROM tumblr_connections tc WHERE tc.workspace_id=?
      `).bind(scope.workspaceId).all<{connectionId:string; lastSynced:string|null; lastError:string|null; lastErrorAt:string|null}>(),
    ])
    const invites = scope.role === 'owner' ? await scope.db.prepare('SELECT id,email,kind,expires_at AS expiresAt FROM invites WHERE workspace_id=? AND accepted_at IS NULL ORDER BY expires_at DESC').bind(scope.workspaceId).all() : { results:[] }
    return c.json({ workspaceId:scope.workspaceId, role: scope.role, characters:characters.results, connections:connections.results.map(cn => { const sync = connectionSync.results.find(cs => cs.connectionId === cn.id); return { ...cn, lastSynced: sync?.lastSynced ?? null, lastError: sync?.lastError ?? null, lastErrorAt: sync?.lastErrorAt ?? null } }), invites:invites.results, lastSuccessfulSync: lastSuccess?.value ?? null, latestError:latestFailure?.error ?? null, latestErrorAt:latestFailure?.attemptedAt ?? null })
  })
  app.patch('/characters/:id/hiatus', async c => {
    const scope=await requireWorkspace(c); const { hiatus }=await c.req.json<{hiatus?:boolean}>()
    if (typeof hiatus !== 'boolean') throw new HTTPException(400,{message:'Invalid request body'})
    const row=await scope.db.prepare('UPDATE characters SET state=? WHERE workspace_id=? AND id=? RETURNING id,name,state').bind(hiatus?'hiatus':'active',scope.workspaceId,c.req.param('id')).first()
    if(!row) throw new HTTPException(404,{message:'Character not found'}); return c.json(row)
  })
  app.delete('/account', async c => {
    const body = await c.req.json<{ confirm?: unknown }>().catch(() => ({ confirm: undefined }))
    if (body.confirm !== 'DELETE') throw new HTTPException(400, { message: 'Type DELETE to confirm' })
    const identity = await requireSession(c)
    const userRow = await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(identity.userId).first<{ email: string }>()
    if (!userRow) throw new HTTPException(404, { message: 'User not found' })
    const memberships = await c.env.DB.prepare('SELECT workspace_id AS workspaceId FROM memberships WHERE user_id=?').bind(identity.userId).all<{ workspaceId: string }>()
    const soleWorkspaces: string[] = []
    const sharedWorkspaces: string[] = []
    for (const m of memberships.results) {
      const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=?').bind(m.workspaceId).first<{ n: number }>()
      if ((count?.n ?? 0) <= 1) soleWorkspaces.push(m.workspaceId)
      else sharedWorkspaces.push(m.workspaceId)
    }
    const statements: D1PreparedStatement[] = []
    for (const ws of soleWorkspaces) {
      for (const table of WORKSPACE_TABLES) {
        statements.push(c.env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).bind(ws))
      }
      statements.push(c.env.DB.prepare('DELETE FROM workspaces WHERE id=?').bind(ws))
    }
    for (const ws of sharedWorkspaces) {
      // If the deleting user is the owner, transfer ownership to another member.
      const ownerRow = await c.env.DB.prepare('SELECT owner_user_id FROM workspaces WHERE id=?').bind(ws).first<{ owner_user_id: string }>()
      if (ownerRow?.owner_user_id === identity.userId) {
        const next = await c.env.DB.prepare('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id!=? LIMIT 1').bind(ws, identity.userId).first<{ user_id: string }>()
        if (next) {
          statements.push(c.env.DB.prepare('UPDATE workspaces SET owner_user_id=? WHERE id=?').bind(next.user_id, ws))
        }
      }
      for (const table of USER_TABLES) {
        statements.push(c.env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND user_id=?`).bind(ws, identity.userId))
      }
    }
    statements.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(identity.userId))
    statements.push(c.env.DB.prepare('DELETE FROM magic_links WHERE email=?').bind(userRow.email))
    statements.push(c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(identity.userId))
    await c.env.DB.batch(statements)
    // R2 icons live under characters/<workspaceId>/... — list by prefix for
    // sole-member workspaces we just deleted. Shared workspaces keep theirs.
    for (const ws of soleWorkspaces) {
      const list = await c.env.ICONS.list({ prefix: `characters/${ws}/` })
      if (list.objects.length) await c.env.ICONS.delete(list.objects.map(o => o.key))
    }
    setCookie(c, COOKIE, '', { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 })
    return c.body(null, 204)
  })

  return app
}
