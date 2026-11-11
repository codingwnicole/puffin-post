import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { requireMembership } from '../db/repositories/workspaces'
import type { Env } from '../worker'

type AuthContext = Context<{ Bindings: Env }>
const COOKIE = '__Host-threadums_session'
const SESSION_SECONDS = 7 * 24 * 60 * 60

export interface SessionIdentity {
  userId: string
  email: string
  workspaceId: string
  sessionId: string
}

export interface WorkspaceIdentity extends SessionIdentity {
  db: Env['DB']
  role: 'owner' | 'member'
}

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signingKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error('Session secret must contain at least 32 characters')
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function requireSession(c: AuthContext): Promise<SessionIdentity> {
  const cookie = getCookie(c, COOKIE) ?? ''
  const match = /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(cookie)
  if (!match) throw new HTTPException(401, { message: 'Sign in required' })
  const signature = Uint8Array.from(match[2].match(/../g)!, (byte) => parseInt(byte, 16))
  if (!await crypto.subtle.verify('HMAC', await signingKey(c.env.SESSION_SECRET), signature, new TextEncoder().encode(match[1]))) {
    throw new HTTPException(401, { message: 'Sign in required' })
  }
  const identity = await c.env.DB.prepare(`
    SELECT s.id_hash AS sessionId, s.user_id AS userId, u.email, s.workspace_id AS workspaceId
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `).bind(await hashToken(match[1]), new Date().toISOString()).first<SessionIdentity>()
  if (!identity) throw new HTTPException(401, { message: 'Sign in required' })
  return identity
}

export async function requireWorkspace(c: AuthContext): Promise<WorkspaceIdentity> {
  const identity = await requireSession(c)
  const workspaceId = c.req.param('workspaceId') ?? identity.workspaceId
  try {
    const membership = await requireMembership(c.env.DB, identity.userId, workspaceId)
    return { ...identity, ...membership, db: c.env.DB }
  } catch {
    throw new HTTPException(403, { message: 'Workspace access denied' })
  }
}

export async function startSession(c: AuthContext, userId: string, workspaceId: string): Promise<void> {
  try { await requireMembership(c.env.DB, userId, workspaceId) } catch {
    throw new HTTPException(403, { message: 'Workspace access denied' })
  }
  const token = randomToken()
  const signature = await crypto.subtle.sign('HMAC', await signingKey(c.env.SESSION_SECRET), new TextEncoder().encode(token))
  const signed = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
  // Rotate the browser's existing session when a new credential is accepted.
  try { await revokeSession(c) } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 401) throw error
  }
  await c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, workspace_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), userId, workspaceId, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()).run()
  setCookie(c, COOKIE, `${token}.${signed}`, { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_SECONDS })
}

async function revokeSession(c: AuthContext): Promise<void> {
  const identity = await requireSession(c)
  await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?')
    .bind(new Date().toISOString(), identity.sessionId).run()
}

export async function endSession(c: AuthContext): Promise<void> {
  await revokeSession(c)
  setCookie(c, COOKIE, '', { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 })
}
