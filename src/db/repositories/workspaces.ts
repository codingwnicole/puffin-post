import type { Database } from '../client'

export interface Membership {
  workspaceId: string
  userId: string
  role: 'owner' | 'member'
  createdAt: string
}

export async function requireMembership(db: Database, userId: string, workspaceId: string): Promise<Membership> {
  const membership = await db.prepare(`
    SELECT workspace_id AS workspaceId, user_id AS userId, role, created_at AS createdAt
    FROM memberships WHERE workspace_id = ? AND user_id = ?
  `).bind(workspaceId, userId).first<Membership>()
  if (!membership) throw new Error('Workspace access denied')
  return membership
}
