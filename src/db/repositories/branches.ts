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
  refreshError: string | null
  statusManualOverrideAt: string | null
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
  starterId?: string
  includeArchived?: boolean
  characterId?: string
  tagId?: string
  q?: string
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
    lastRefreshAt: null, refreshError: null, statusManualOverrideAt: null,
    archivedAt: status === 'archived' ? createdAt : null, createdAt,
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
      b.refresh_error AS refreshError, b.status_manual_override_at AS statusManualOverrideAt,
      b.archived_at AS archivedAt, b.created_at AS createdAt, s.title, s.character_id AS characterId,
      c.name AS characterName, c.icon_object_key AS iconObjectKey,
      s.source, s.root_post_id AS rootPostId, s.root_blog_id AS rootBlogId, p.display_label AS partnerLabel
    FROM reply_branches b
    JOIN starters s ON s.workspace_id = b.workspace_id AND s.id = b.starter_id
    JOIN characters c ON c.workspace_id = s.workspace_id AND c.id = s.character_id
    LEFT JOIN partners p ON p.workspace_id = b.workspace_id AND p.id = b.partner_id
    WHERE b.workspace_id = ? AND ${status === undefined ? (input.includeArchived ? '1 = 1' : 'b.archived_at IS NULL') : 'b.status = ?'}
      ${input.starterId ? 'AND b.starter_id = ?' : ''}
      ${input.characterId ? 'AND s.character_id = ?' : ''}
      ${input.tagId ? 'AND EXISTS (SELECT 1 FROM starter_tags st WHERE st.workspace_id=b.workspace_id AND st.starter_id=b.starter_id AND st.tag_id=?)' : ''}
      ${input.q ? "AND (lower(s.title) LIKE ? OR lower(c.name) LIKE ? OR lower(COALESCE(p.display_label,'')) LIKE ?)" : ''}
    ORDER BY COALESCE(b.last_activity_at, b.created_at) DESC, b.id
  `).bind(...[workspaceId, ...(status === undefined ? [] : [status]), ...(input.starterId ? [input.starterId] : []), ...(input.characterId ? [input.characterId] : []), ...(input.tagId ? [input.tagId] : []), ...(input.q ? Array(3).fill(`%${input.q.toLocaleLowerCase()}%`) : [])]).all<InboxBranch>()
  return result.results
}

export async function updateReplyBranch(scope: WorkspaceScope, id: string,
  patch: { partnerId?: string | null; status?: ReplyStatus; notes?: string }): Promise<ReplyBranch> {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  if (patch.partnerId != null && !await scope.db.prepare('SELECT id FROM partners WHERE workspace_id=? AND id=?')
    .bind(scope.workspaceId,patch.partnerId).first()) throw new Error('Partner not found')
  if (patch.status !== undefined && !REPLY_STATUSES.includes(patch.status)) throw new Error('Invalid reply status')
  const result = await scope.db.prepare(`UPDATE reply_branches SET
    partner_id = CASE WHEN ? THEN ? ELSE partner_id END,
    notes = CASE WHEN ? THEN ? ELSE notes END,
    status = COALESCE(?,status),
    archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at,?) WHEN ? IS NOT NULL THEN NULL ELSE archived_at END,
    status_manual_override_at = CASE WHEN ? IS NOT NULL THEN ? ELSE status_manual_override_at END
    WHERE workspace_id=? AND id=? RETURNING id`)
    .bind(patch.partnerId !== undefined,patch.partnerId ?? null,patch.notes !== undefined,patch.notes ?? null,
      patch.status ?? null,patch.status ?? null,new Date().toISOString(),patch.status ?? null,patch.status ?? null,new Date().toISOString(),scope.workspaceId,id).first()
  if (!result) throw new Error('Branch not found')
  return (await listInboxBranches({ ...scope, includeArchived: true })).find(b => b.id === id)!
}
