import { HTTPException } from 'hono/http-exception'
import { requireMembership } from '../db/repositories/workspaces'
import type { WorkspaceScope } from '../db/client'
import type { Env } from '../worker'
import { hashToken, randomToken } from './sessions'

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new HTTPException(400, { message: 'Valid email required' })
  }
  return value.trim().toLowerCase()
}

export interface Invite {
  id: string
  workspaceId: string
  email: string
  kind: 'beta' | 'shared'
}

/** Provisions only the designated first owner; it is never public registration. */
export async function provisionBootstrapOwner(db: Env['DB'], email: string, bootstrapEmail?: string): Promise<boolean> {
  if (!bootstrapEmail) return false
  let expected: string
  try { expected = normalizeEmail(bootstrapEmail) } catch { return false }
  if (email !== expected) return false
  const userId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  const displayName = email.split('@')[0]
  await db.batch([
    db.prepare(`INSERT INTO users (id,email,display_name,auth_identity)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`).bind(userId, email, displayName, `email:${email}`),
    db.prepare(`INSERT INTO workspaces (id,name,owner_user_id)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM workspaces)`)
      .bind(workspaceId, `${displayName}'s workspace`, userId, userId),
    db.prepare(`INSERT INTO memberships (workspace_id,user_id,role)
      SELECT ?, ?, 'owner' WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)`)
      .bind(workspaceId, userId, workspaceId),
  ])
  return Boolean(await db.prepare(`SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE u.email = ? AND m.role = 'owner' LIMIT 1`).bind(email).first())
}

export async function createInvite(input: WorkspaceScope & { email: string; kind?: 'beta' | 'shared' }) {
  let membership
  try { membership = await requireMembership(input.db, input.userId, input.workspaceId) } catch {
    throw new HTTPException(403, { message: 'Workspace access denied' })
  }
  if (membership.role !== 'owner') throw new HTTPException(403, { message: 'Owner access required' })
  const email = normalizeEmail(input.email)
  const kind = input.kind ?? 'beta'
  if (kind !== 'beta' && kind !== 'shared') throw new HTTPException(400, { message: 'Invalid invite kind' })
  const token = randomToken()
  const id = crypto.randomUUID()
  await input.db.prepare('INSERT INTO invites (id, workspace_id, email, token_hash, expires_at, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, input.workspaceId, email, await hashToken(token), new Date(Date.now() + 7 * 86400_000).toISOString(), kind).run()
  return { id, token, email, workspaceId: input.workspaceId, kind }
}

export async function findInvite(db: Env['DB'], token: string, email: string, workspaceId: string): Promise<Invite> {
  const invite = await db.prepare(`SELECT id, workspace_id AS workspaceId, email, kind FROM invites
    WHERE token_hash = ? AND email = ? AND workspace_id = ? AND accepted_at IS NULL AND expires_at > ?`)
    .bind(await hashToken(token), normalizeEmail(email), workspaceId, new Date().toISOString()).first<Invite>()
  if (!invite) throw new HTTPException(400, { message: 'invalid invite' })
  return invite
}

export async function acceptInvite(db: Env['DB'], inviteId: string, email: string, issuingWorkspaceId: string) {
  const now = new Date().toISOString()
  const invite = await db.prepare(`SELECT id, workspace_id AS workspaceId, email, kind FROM invites
    WHERE id = ? AND email = ? AND workspace_id = ? AND accepted_at IS NULL AND expires_at > ?`)
    .bind(inviteId, email, issuingWorkspaceId, now).first<Invite>()
  if (!invite) throw new HTTPException(400, { message: 'invalid invite' })
  const userId = crypto.randomUUID()
  const workspaceId = invite.kind === 'beta' ? crypto.randomUUID() : invite.workspaceId
  const eligible = 'SELECT 1 FROM invites WHERE id = ? AND email = ? AND workspace_id = ? AND accepted_at IS NULL AND expires_at > ?'
  const args = [inviteId, email, issuingWorkspaceId, now]
  // D1 batches are atomic: concurrent redemption cannot create a second workspace or membership.
  const statements = [db.prepare(`INSERT INTO users (id, email, display_name, auth_identity)
    SELECT ?, ?, ?, ? WHERE EXISTS (${eligible}) ON CONFLICT(email) DO NOTHING`)
    .bind(userId, email, email.split('@')[0], `email:${email}`, ...args)]
  if (invite.kind === 'beta') {
    statements.push(db.prepare(`INSERT INTO workspaces (id, name, owner_user_id)
      SELECT ?, ?, u.id FROM users u WHERE u.email = ? AND EXISTS (${eligible})`)
      .bind(workspaceId, `${email.split('@')[0]}'s workspace`, email, ...args))
  }
  statements.push(db.prepare(`INSERT INTO memberships (workspace_id, user_id, role)
    SELECT ?, u.id, ? FROM users u WHERE u.email = ? AND EXISTS (${eligible})
    ON CONFLICT(workspace_id, user_id) DO NOTHING`)
    .bind(workspaceId, invite.kind === 'beta' ? 'owner' : 'member', email, ...args))
  statements.push(db.prepare(`UPDATE invites SET accepted_at = ? WHERE id = ? AND email = ? AND workspace_id = ?
    AND accepted_at IS NULL AND expires_at > ? RETURNING id`).bind(now, ...args))
  const results = await db.batch(statements)
  if (!results.at(-1)!.results.length) throw new HTTPException(400, { message: 'invalid invite' })
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>()
  return { userId: user!.id, workspaceId }
}
