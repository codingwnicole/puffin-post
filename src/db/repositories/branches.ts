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
  nextCheckAt: string | null
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
  oldestFirst?: boolean
}

export type RpUnsortedReason = 'none' | 'no_rps' | 'multiple_rps'

export interface InboxBranch extends ReplyBranch {
  title: string
  description: string
  characterId: string
  characterName: string
  groupId: string | null
  groupName: string | null
  rpUnsortedReason: RpUnsortedReason
  iconObjectKey: string | null
  source: 'tumblr'
  rootPostId: string
  rootBlogId: string
  starterArchived: number
  partnerLabel: string | null
}

export async function upsertReplyBranch(input: CreateReplyBranchInput): Promise<ReplyBranch> {
  const { db, workspaceId } = input
  const inputPartner = input.partnerId ?? null
  const existing = await db.prepare(`SELECT id, workspace_id AS workspaceId, starter_id AS starterId, partner_id AS partnerId,
    status, notes, latest_post_id AS latestPostId, last_poster AS lastPoster, last_activity_at AS lastActivityAt,
    last_refresh_at AS lastRefreshAt, refresh_error AS refreshError, status_manual_override_at AS statusManualOverrideAt,
    archived_at AS archivedAt, created_at AS createdAt, next_check_at AS nextCheckAt
    FROM reply_branches
    WHERE workspace_id = ? AND starter_id = ? AND archived_at IS NULL
      AND ((? IS NULL AND partner_id IS NULL) OR partner_id = ?)
    ORDER BY created_at DESC LIMIT 1`)
    .bind(workspaceId, input.starterId, inputPartner, inputPartner).first<ReplyBranch>()
  if (existing) {
    const nextStatus: ReplyStatus = input.status ?? existing.status
    const updatedAt = new Date().toISOString()
    await db.prepare(`UPDATE reply_branches SET
      status = ?,
      latest_post_id = CASE WHEN ? THEN ? ELSE latest_post_id END,
      last_poster = CASE WHEN ? THEN ? ELSE last_poster END,
      last_activity_at = CASE WHEN ? THEN ? ELSE last_activity_at END,
      status_manual_override_at = CASE WHEN ? = 'archived' THEN ? ELSE status_manual_override_at END,
      archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) WHEN ? IS NOT NULL THEN NULL ELSE archived_at END
      WHERE workspace_id = ? AND id = ?`)
      .bind(nextStatus,
        input.latestPostId != null, input.latestPostId ?? null,
        input.lastPoster != null, input.lastPoster ?? null,
        input.lastActivityAt != null, input.lastActivityAt ?? null,
        nextStatus, updatedAt,
        nextStatus, updatedAt, nextStatus,
        workspaceId, existing.id).run()
    const merged = await db.prepare(`SELECT id, workspace_id AS workspaceId, starter_id AS starterId, partner_id AS partnerId,
      status, notes, latest_post_id AS latestPostId, last_poster AS lastPoster, last_activity_at AS lastActivityAt,
      last_refresh_at AS lastRefreshAt, refresh_error AS refreshError, status_manual_override_at AS statusManualOverrideAt,
      archived_at AS archivedAt, created_at AS createdAt, next_check_at AS nextCheckAt
      FROM reply_branches WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, existing.id).first<ReplyBranch>()
    return merged!
  }
  return createReplyBranch(input)
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
    archivedAt: status === 'archived' ? createdAt : null, createdAt, nextCheckAt: null,
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
      b.archived_at AS archivedAt, b.created_at AS createdAt, b.next_check_at AS nextCheckAt, s.title, s.description, s.character_id AS characterId,
      c.name AS characterName, c.icon_object_key AS iconObjectKey, COALESCE(g.id, fallback_g.id) AS groupId,
      COALESCE(g.name, fallback_g.name) AS groupName,
      CASE
        WHEN g.id IS NOT NULL THEN 'none'
        WHEN (SELECT COUNT(*) FROM rp_group_characters rgc WHERE rgc.workspace_id = s.workspace_id AND rgc.character_id = s.character_id) = 1 THEN 'none'
        WHEN (SELECT COUNT(*) FROM rp_group_characters rgc WHERE rgc.workspace_id = s.workspace_id AND rgc.character_id = s.character_id) > 1 THEN 'multiple_rps'
        ELSE 'no_rps'
      END AS rpUnsortedReason,
      s.source, s.root_post_id AS rootPostId, s.root_blog_id AS rootBlogId, s.archived AS starterArchived, p.display_label AS partnerLabel
    FROM reply_branches b
    JOIN starters s ON s.workspace_id = b.workspace_id AND s.id = b.starter_id
    JOIN characters c ON c.workspace_id = s.workspace_id AND c.id = s.character_id
    LEFT JOIN rp_groups g ON g.workspace_id=s.workspace_id AND g.id=s.rp_group_id
    LEFT JOIN rp_groups fallback_g ON fallback_g.workspace_id = s.workspace_id AND g.id IS NULL
      AND (SELECT COUNT(*) FROM rp_group_characters rgc WHERE rgc.workspace_id = s.workspace_id AND rgc.character_id = s.character_id) = 1
      AND fallback_g.id = (SELECT rgc.group_id FROM rp_group_characters rgc WHERE rgc.workspace_id = s.workspace_id AND rgc.character_id = s.character_id)
    LEFT JOIN partners p ON p.workspace_id = b.workspace_id AND p.id = b.partner_id
    WHERE b.workspace_id = ? AND ${status === undefined ? (input.includeArchived ? '1 = 1' : '(b.archived_at IS NULL AND s.archived = 0)') : '(b.status = ? AND s.archived = 0)'}
      ${input.starterId ? 'AND b.starter_id = ?' : ''}
      ${input.characterId ? 'AND s.character_id = ?' : ''}
      ${input.tagId ? 'AND EXISTS (SELECT 1 FROM starter_tags st WHERE st.workspace_id=b.workspace_id AND st.starter_id=b.starter_id AND st.tag_id=?)' : ''}
      ${input.q ? "AND (lower(s.title) LIKE ? OR lower(c.name) LIKE ? OR lower(COALESCE(p.display_label,'')) LIKE ?)" : ''}
    ORDER BY COALESCE(b.last_activity_at, b.created_at) ${input.oldestFirst ? 'ASC' : 'DESC'}, b.id
  `).bind(...[workspaceId, ...(status === undefined ? [] : [status]), ...(input.starterId ? [input.starterId] : []), ...(input.characterId ? [input.characterId] : []), ...(input.tagId ? [input.tagId] : []), ...(input.q ? Array(3).fill(`%${input.q.toLocaleLowerCase()}%`) : [])]).all<InboxBranch>()
  return result.results
}

export async function updateReplyBranch(scope: WorkspaceScope, id: string,
  patch: { partnerId?: string | null; status?: ReplyStatus; notes?: string; nextCheckAt?: string | null }): Promise<ReplyBranch> {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  if (patch.partnerId != null && !await scope.db.prepare('SELECT id FROM partners WHERE workspace_id=? AND id=?')
    .bind(scope.workspaceId,patch.partnerId).first()) throw new Error('Partner not found')
  if (patch.status !== undefined && !REPLY_STATUSES.includes(patch.status)) throw new Error('Invalid reply status')
  const result = await scope.db.prepare(`UPDATE reply_branches SET
    partner_id = CASE WHEN ? THEN ? ELSE partner_id END,
    notes = CASE WHEN ? THEN ? ELSE notes END,
    status = COALESCE(?,status),
    next_check_at = CASE WHEN ? THEN ? ELSE next_check_at END,
    archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at,?) WHEN ? IS NOT NULL THEN NULL ELSE archived_at END,
    status_manual_override_at = CASE WHEN ? IS NOT NULL THEN ? ELSE status_manual_override_at END
    WHERE workspace_id=? AND id=? RETURNING id`)
    .bind(patch.partnerId !== undefined,patch.partnerId ?? null,patch.notes !== undefined,patch.notes ?? null,
      patch.status ?? null,patch.nextCheckAt !== undefined,patch.nextCheckAt ?? null,patch.status ?? null,new Date().toISOString(),patch.status ?? null,patch.status ?? null,new Date().toISOString(),scope.workspaceId,id).first()
  if (!result) throw new Error('Branch not found')
  return (await listInboxBranches({ ...scope, includeArchived: true })).find(b => b.id === id)!
}
