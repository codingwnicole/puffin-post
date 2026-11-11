import { REPLY_STATUSES, type ReplyStatus } from '../../shared/domain'
import type { WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'

export interface ReplyBranch {
  id: string
  workspaceId: string
  starterId: string
  partnerId: string | null
  status: ReplyStatus
  notes: string
  latestPostId: string | null
  lastPoster: string | null
  lastActivityAt: string | null
  lastRefreshAt: string | null
  archivedAt: string | null
  createdAt: string
}

export interface CreateReplyBranchInput extends WorkspaceScope {
  starterId: string
  partnerId?: string | null
  status?: ReplyStatus
  notes?: string
  latestPostId?: string | null
  lastPoster?: string | null
  lastActivityAt?: string | null
}

export interface InboxQuery extends WorkspaceScope {
  status?: ReplyStatus
}

export interface InboxBranch extends ReplyBranch {
  title: string
  characterId: string
  characterName: string
  iconObjectKey: string | null
  source: 'tumblr'
  rootPostId: string
  rootBlogId: string
  partnerLabel: string | null
}

export async function createReplyBranch(input: CreateReplyBranchInput): Promise<ReplyBranch> {
  const { db, userId, workspaceId } = input
  await requireMembership(db, userId, workspaceId)
  const starter = await db.prepare('SELECT id FROM starters WHERE workspace_id = ? AND id = ?')
    .bind(workspaceId, input.starterId).first()
  if (!starter) throw new Error('Starter not found')
  if (input.partnerId != null) {
    const partner = await db.prepare('SELECT id FROM partners WHERE workspace_id = ? AND id = ?')
      .bind(workspaceId, input.partnerId).first()
    if (!partner) throw new Error('Partner not found')
  }
  const status = input.status ?? 'your_turn'
  if (!REPLY_STATUSES.includes(status)) throw new Error('Invalid reply status')
  const createdAt = new Date().toISOString()
  const branch: ReplyBranch = {
    id: crypto.randomUUID(), workspaceId, starterId: input.starterId, partnerId: input.partnerId ?? null,
    status, notes: input.notes ?? '', latestPostId: input.latestPostId ?? null,
    lastPoster: input.lastPoster ?? null, lastActivityAt: input.lastActivityAt ?? null,
    lastRefreshAt: null, archivedAt: status === 'archived' ? createdAt : null, createdAt,
  }
  await db.prepare(`
    INSERT INTO reply_branches (id, workspace_id, starter_id, partner_id, status, notes,
      latest_post_id, last_poster, last_activity_at, last_refresh_at, archived_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(branch.id, workspaceId, branch.starterId, branch.partnerId, branch.status, branch.notes,
    branch.latestPostId, branch.lastPoster, branch.lastActivityAt, branch.lastRefreshAt, branch.archivedAt, branch.createdAt).run()
  return branch
}

export async function listInboxBranches(input: InboxQuery): Promise<InboxBranch[]> {
  const { db, userId, workspaceId, status } = input
  await requireMembership(db, userId, workspaceId)
  if (status !== undefined && !REPLY_STATUSES.includes(status)) throw new Error('Invalid reply status')
  const result = await db.prepare(`
    SELECT b.id, b.workspace_id AS workspaceId, b.starter_id AS starterId, b.partner_id AS partnerId,
      b.status, b.notes, b.latest_post_id AS latestPostId, b.last_poster AS lastPoster,
      b.last_activity_at AS lastActivityAt, b.last_refresh_at AS lastRefreshAt,
      b.archived_at AS archivedAt, b.created_at AS createdAt, s.title, s.character_id AS characterId,
      c.name AS characterName, c.icon_object_key AS iconObjectKey,
      s.source, s.root_post_id AS rootPostId, s.root_blog_id AS rootBlogId, p.display_label AS partnerLabel
    FROM reply_branches b
    JOIN starters s ON s.workspace_id = b.workspace_id AND s.id = b.starter_id
    JOIN characters c ON c.workspace_id = s.workspace_id AND c.id = s.character_id
    LEFT JOIN partners p ON p.workspace_id = b.workspace_id AND p.id = b.partner_id
    WHERE b.workspace_id = ? AND ${status === undefined ? 'b.archived_at IS NULL' : 'b.status = ?'}
    ORDER BY COALESCE(b.last_activity_at, b.created_at) DESC, b.id
  `).bind(...(status === undefined ? [workspaceId] : [workspaceId, status])).all<InboxBranch>()
  return result.results
}
