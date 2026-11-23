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
  latestReplyExcerpt: string | null
  lastRefreshAt: string | null
  refreshError: string | null
  statusManualOverrideAt: string | null
  statusBeforeArchive?: 'your_turn' | 'their_turn' | 'queued' | null
  archivedAt: string | null
  createdAt: string
  nextCheckAt: string | null
  latestReplySource?: string
  latestReplyConfidence?: string
  latestReplyEvidence?: string
  partnerMuses?: string[]
  partnerMusesSource?: string
  partnerMusesConfidence?: string
  partnerMusesEvidence?: string
  partnerMusesManualOverrideAt?: string | null
  userRecap?: string
}

export interface CreateReplyBranchInput extends WorkspaceScope {
  starterId: string
  partnerId?: string | null
  status?: ReplyStatus
  notes?: string
  latestPostId?: string | null
  lastPoster?: string | null
  lastActivityAt?: string | null
  latestReplyExcerpt?: string | null
  latestReplySource?: string
  latestReplyConfidence?: string
  latestReplyEvidence?: string | null
  partnerMuses?: string[]
  partnerMusesSource?: string
  partnerMusesConfidence?: string
  partnerMusesEvidence?: string | null
}

export interface InboxQuery extends WorkspaceScope {
  status?: ReplyStatus
  starterId?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  characterId?: string
  tagId?: string
  q?: string
  oldestFirst?: boolean
  // Bounded paging for large accounts: limit rows returned and skip back with
  // offset. The inbox is the one genuinely growing list; the other list routes
  // return small, fixed-shape data and stay unbounded.
  limit?: number
  offset?: number
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
  userRecap?: string
}

function parseBranch<T extends { partnerMusesJson?: string | null }>(row: T): Omit<T, 'partnerMusesJson'> & { partnerMuses: string[] } {
  let partnerMuses: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.partnerMusesJson ?? '[]')
    if (Array.isArray(parsed)) partnerMuses = parsed.filter((name): name is string => typeof name === 'string')
  } catch { /* Invalid historical metadata is treated as unresolved. */ }
  const { partnerMusesJson: _ignored, ...rest } = row
  return { ...rest, partnerMuses }
}

export async function upsertReplyBranch(input: CreateReplyBranchInput): Promise<ReplyBranch> {
  const { db, workspaceId } = input
  const inputPartner = input.partnerId ?? null
  const existing = await db.prepare(`SELECT id, workspace_id AS workspaceId, starter_id AS starterId, partner_id AS partnerId,
    status, notes, latest_post_id AS latestPostId, last_poster AS lastPoster, last_activity_at AS lastActivityAt,
    latest_reply_excerpt AS latestReplyExcerpt,
    latest_reply_source AS latestReplySource, latest_reply_confidence AS latestReplyConfidence,
    latest_reply_evidence AS latestReplyEvidence,
    last_refresh_at AS lastRefreshAt, refresh_error AS refreshError, status_manual_override_at AS statusManualOverrideAt,
    archived_at AS archivedAt, created_at AS createdAt, next_check_at AS nextCheckAt,
    partner_muses_json AS partnerMusesJson, partner_muses_source AS partnerMusesSource,
    partner_muses_confidence AS partnerMusesConfidence, partner_muses_evidence AS partnerMusesEvidence,
    partner_muses_manual_override_at AS partnerMusesManualOverrideAt, user_recap AS userRecap
    FROM reply_branches
    WHERE workspace_id = ? AND starter_id = ?
      AND ((? IS NULL AND partner_id IS NULL) OR partner_id = ?)
    ORDER BY (archived_at IS NULL) DESC, created_at DESC LIMIT 1`)
    .bind(workspaceId, input.starterId, inputPartner, inputPartner).first<ReplyBranch>()
  if (existing) {
    const branchArchived = Boolean(existing.archivedAt) || existing.status === 'archived'
    const nextStatus: ReplyStatus = branchArchived ? 'archived' : input.status ?? existing.status
    const updatedAt = new Date().toISOString()
    await db.prepare(`UPDATE reply_branches SET
      status = ?,
      latest_post_id = CASE WHEN ? THEN ? ELSE latest_post_id END,
      last_poster = CASE WHEN ? THEN ? ELSE last_poster END,
      last_activity_at = CASE WHEN ? THEN ? ELSE last_activity_at END,
      latest_reply_excerpt = CASE WHEN ? THEN ? ELSE latest_reply_excerpt END,
      latest_reply_source = CASE WHEN ? THEN ? ELSE latest_reply_source END,
      latest_reply_confidence = CASE WHEN ? THEN ? ELSE latest_reply_confidence END,
      latest_reply_evidence = CASE WHEN ? THEN ? ELSE latest_reply_evidence END,
      status_manual_override_at = CASE WHEN ? = 'archived' THEN ? ELSE status_manual_override_at END,
      archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE archived_at END,
      partner_muses_json=CASE WHEN partner_muses_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE partner_muses_json END,
      partner_muses_source=CASE WHEN partner_muses_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE partner_muses_source END,
      partner_muses_confidence=CASE WHEN partner_muses_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE partner_muses_confidence END,
      partner_muses_evidence=CASE WHEN partner_muses_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE partner_muses_evidence END
      WHERE workspace_id = ? AND id = ?`)
      .bind(nextStatus,
        input.latestPostId != null, input.latestPostId ?? null,
        input.lastPoster != null, input.lastPoster ?? null,
        input.lastActivityAt != null, input.lastActivityAt ?? null,
        input.latestPostId != null, input.latestReplyExcerpt ?? null,
        input.latestPostId != null, input.latestReplySource ?? (input.latestReplyExcerpt ? 'structured_metadata' : 'unresolved'),
        input.latestPostId != null, input.latestReplyConfidence ?? (input.latestReplyExcerpt ? 'high' : 'none'),
        input.latestPostId != null, input.latestReplyEvidence ?? '',
        nextStatus, updatedAt,
        nextStatus, updatedAt,
        input.partnerMuses !== undefined, JSON.stringify(input.partnerMuses ?? []),
        input.partnerMuses !== undefined, input.partnerMusesSource ?? 'unresolved',
        input.partnerMuses !== undefined, input.partnerMusesConfidence ?? 'none',
        input.partnerMuses !== undefined, input.partnerMusesEvidence ?? '',
        workspaceId, existing.id).run()
    const merged = await db.prepare(`SELECT id, workspace_id AS workspaceId, starter_id AS starterId, partner_id AS partnerId,
      status, notes, latest_post_id AS latestPostId, last_poster AS lastPoster, last_activity_at AS lastActivityAt,
      latest_reply_excerpt AS latestReplyExcerpt,
      latest_reply_source AS latestReplySource, latest_reply_confidence AS latestReplyConfidence,
      latest_reply_evidence AS latestReplyEvidence,
      last_refresh_at AS lastRefreshAt, refresh_error AS refreshError, status_manual_override_at AS statusManualOverrideAt,
      archived_at AS archivedAt, created_at AS createdAt, next_check_at AS nextCheckAt,
      partner_muses_json AS partnerMusesJson, partner_muses_source AS partnerMusesSource,
      partner_muses_confidence AS partnerMusesConfidence, partner_muses_evidence AS partnerMusesEvidence,
      partner_muses_manual_override_at AS partnerMusesManualOverrideAt, user_recap AS userRecap
      FROM reply_branches WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, existing.id).first<ReplyBranch & { partnerMusesJson?: string | null }>()
    return parseBranch(merged!) as ReplyBranch
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
    latestReplyExcerpt: input.latestReplyExcerpt ?? null,
    latestReplySource: input.latestReplySource ?? (input.latestReplyExcerpt ? 'structured_metadata' : 'unresolved'),
    latestReplyConfidence: input.latestReplyConfidence ?? (input.latestReplyExcerpt ? 'high' : 'none'),
    latestReplyEvidence: input.latestReplyEvidence ?? '',
    lastRefreshAt: null, refreshError: null, statusManualOverrideAt: null,
    archivedAt: status === 'archived' ? createdAt : null, createdAt, nextCheckAt: null,
    partnerMuses: input.partnerMuses ?? [], partnerMusesSource: input.partnerMusesSource ?? 'unresolved',
    partnerMusesConfidence: input.partnerMusesConfidence ?? 'none', partnerMusesEvidence: input.partnerMusesEvidence ?? '',
    partnerMusesManualOverrideAt: null, userRecap: '',
  }
  await db.prepare(`
    INSERT INTO reply_branches (id, workspace_id, starter_id, partner_id, status, notes,
      latest_post_id, last_poster, last_activity_at, latest_reply_excerpt, last_refresh_at, archived_at, created_at,
      partner_muses_json, partner_muses_source, partner_muses_confidence, partner_muses_evidence,
      latest_reply_source, latest_reply_confidence, latest_reply_evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(branch.id, workspaceId, branch.starterId, branch.partnerId, branch.status, branch.notes,
    branch.latestPostId, branch.lastPoster, branch.lastActivityAt, branch.latestReplyExcerpt, branch.lastRefreshAt, branch.archivedAt, branch.createdAt,
    JSON.stringify(branch.partnerMuses), branch.partnerMusesSource, branch.partnerMusesConfidence, branch.partnerMusesEvidence,
    branch.latestReplySource, branch.latestReplyConfidence, branch.latestReplyEvidence).run()
  return branch
}

export async function listInboxBranches(input: InboxQuery): Promise<InboxBranch[]> {
  const { db, userId, workspaceId, status } = input
  await requireMembership(db, userId, workspaceId)
  if (status !== undefined && !REPLY_STATUSES.includes(status)) throw new Error('Invalid reply status')
  const hideArchived = !(input.includeArchived || input.archivedOnly || input.characterId)
  const statusFilter = input.archivedOnly
    ? '(b.archived_at IS NOT NULL OR b.status = \'archived\' OR s.archived = 1)'
    : status === 'archived'
      ? '(b.archived_at IS NOT NULL OR b.status = \'archived\' OR s.archived = 1)'
      : status === undefined
        ? (input.includeArchived ? '1 = 1' : '(b.archived_at IS NULL AND b.status <> \'archived\' AND s.archived = 0)')
        : '(b.status = ? AND b.archived_at IS NULL AND s.archived = 0)'
  const result = await db.prepare(`
    SELECT b.id, b.workspace_id AS workspaceId, b.starter_id AS starterId, b.partner_id AS partnerId,
      b.status, b.notes, b.latest_post_id AS latestPostId, b.last_poster AS lastPoster,
      b.last_activity_at AS lastActivityAt, b.latest_reply_excerpt AS latestReplyExcerpt,
      b.latest_reply_source AS latestReplySource, b.latest_reply_confidence AS latestReplyConfidence, b.latest_reply_evidence AS latestReplyEvidence,
      b.last_refresh_at AS lastRefreshAt,
      b.refresh_error AS refreshError, b.status_manual_override_at AS statusManualOverrideAt,
      b.archived_at AS archivedAt, b.created_at AS createdAt, b.next_check_at AS nextCheckAt, s.title, s.description, s.character_id AS characterId,
      b.partner_muses_json AS partnerMusesJson, b.partner_muses_source AS partnerMusesSource,
      b.partner_muses_confidence AS partnerMusesConfidence, b.partner_muses_evidence AS partnerMusesEvidence,
      b.partner_muses_manual_override_at AS partnerMusesManualOverrideAt, b.user_recap AS userRecap,
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
    WHERE b.workspace_id = ? AND ${statusFilter}${hideArchived ? " AND c.state <> 'archived'" : ''}
      ${input.starterId ? 'AND b.starter_id = ?' : ''}
      ${input.characterId ? 'AND s.character_id = ?' : ''}
      ${input.tagId ? 'AND EXISTS (SELECT 1 FROM starter_tags st WHERE st.workspace_id=b.workspace_id AND st.starter_id=b.starter_id AND st.tag_id=?)' : ''}
      ${input.q ? "AND (lower(s.title) LIKE ? OR lower(s.description) LIKE ? OR lower(c.name) LIKE ? OR lower(COALESCE(p.display_label,'')) LIKE ? OR lower(b.user_recap) LIKE ? OR lower(b.partner_muses_json) LIKE ?)" : ''}
    ORDER BY COALESCE(b.last_activity_at, b.created_at) ${input.oldestFirst ? 'ASC' : 'DESC'}, b.id
    LIMIT ${input.limit ?? 200} OFFSET ${input.offset ?? 0}
   `).bind(...[workspaceId, ...(status !== undefined && status !== 'archived' && !input.archivedOnly ? [status] : []), ...(input.starterId ? [input.starterId] : []), ...(input.characterId ? [input.characterId] : []), ...(input.tagId ? [input.tagId] : []), ...(input.q ? Array(6).fill(`%${input.q.toLocaleLowerCase()}%`) : [])]).all<InboxBranch & { partnerMusesJson?: string | null }>()
  return result.results.map(row => parseBranch(row) as InboxBranch)
}

export async function updateReplyBranch(scope: WorkspaceScope, id: string,
  patch: { partnerId?: string | null; status?: ReplyStatus; notes?: string; nextCheckAt?: string | null; partnerMuses?: string[]; userRecap?: string }): Promise<ReplyBranch> {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  if (patch.partnerId != null && !await scope.db.prepare('SELECT id FROM partners WHERE workspace_id=? AND id=?')
    .bind(scope.workspaceId,patch.partnerId).first()) throw new Error('Partner not found')
  if (patch.status !== undefined && !REPLY_STATUSES.includes(patch.status)) throw new Error('Invalid reply status')
  if (patch.status && patch.status !== 'archived' && await scope.db.prepare(`SELECT 1 FROM reply_branches b JOIN starters s ON s.workspace_id=b.workspace_id AND s.id=b.starter_id
      WHERE b.workspace_id=? AND b.id=? AND s.archived=1`).bind(scope.workspaceId,id).first()) throw new Error('Restore the archived thread before restoring this reply')
  const result = await scope.db.prepare(`UPDATE reply_branches SET
    partner_id = CASE WHEN ? THEN ? ELSE partner_id END,
    notes = CASE WHEN ? THEN ? ELSE notes END,
    status_before_archive = CASE WHEN ? = 'archived' AND status <> 'archived' THEN status WHEN ? IS NOT NULL AND ? <> 'archived' THEN NULL ELSE status_before_archive END,
    status = CASE WHEN ? = 'archived' THEN 'archived' WHEN ? IS NOT NULL AND status = 'archived' THEN ? ELSE COALESCE(?,status) END,
    next_check_at = CASE WHEN ? THEN ? ELSE next_check_at END,
    archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at,?) WHEN ? IS NOT NULL THEN NULL ELSE archived_at END,
    status_manual_override_at = CASE WHEN ? IS NOT NULL THEN ? ELSE status_manual_override_at END,
    partner_muses_json = CASE WHEN ? THEN ? ELSE partner_muses_json END,
    partner_muses_source = CASE WHEN ? THEN 'manual' ELSE partner_muses_source END,
    partner_muses_confidence = CASE WHEN ? THEN 'high' ELSE partner_muses_confidence END,
    partner_muses_evidence = CASE WHEN ? THEN 'Edited by the writer' ELSE partner_muses_evidence END,
    partner_muses_manual_override_at = CASE WHEN ? THEN ? ELSE partner_muses_manual_override_at END,
    user_recap = CASE WHEN ? THEN ? ELSE user_recap END
    WHERE workspace_id=? AND id=? RETURNING id`)
    .bind(patch.partnerId !== undefined,patch.partnerId ?? null,patch.notes !== undefined,patch.notes ?? null,
      patch.status ?? null,patch.status ?? null,patch.status ?? null,patch.status ?? null,patch.status ?? null,patch.status ?? null,patch.status ?? null,
      patch.nextCheckAt !== undefined,patch.nextCheckAt ?? null,patch.status ?? null,new Date().toISOString(),patch.status ?? null,
      patch.status ?? null,new Date().toISOString(),patch.partnerMuses !== undefined,JSON.stringify(patch.partnerMuses ?? []),
      patch.partnerMuses !== undefined,patch.partnerMuses !== undefined,patch.partnerMuses !== undefined,
      patch.partnerMuses !== undefined,new Date().toISOString(),patch.userRecap !== undefined,patch.userRecap ?? null,
      scope.workspaceId,id).first()
  if (!result) throw new Error('Branch not found')
  return (await listInboxBranches({ ...scope, includeArchived: true })).find(b => b.id === id)!
}

/** Restore only an archived reply branch, retaining its turn state from before archiving. */
export async function restoreReplyBranch(scope: WorkspaceScope, id: string): Promise<InboxBranch> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  if (await scope.db.prepare(`SELECT 1 FROM reply_branches b JOIN starters s ON s.workspace_id=b.workspace_id AND s.id=b.starter_id
      WHERE b.workspace_id=? AND b.id=? AND s.archived=1`).bind(scope.workspaceId,id).first()) {
    throw new Error('Restore the archived thread before restoring this reply')
  }
  const result = await scope.db.prepare(`UPDATE reply_branches SET
    status=COALESCE(status_before_archive,'queued'), status_before_archive=NULL, archived_at=NULL,
    status_manual_override_at=?
    WHERE workspace_id=? AND id=? AND (status='archived' OR archived_at IS NOT NULL) RETURNING id`)
    .bind(new Date().toISOString(),scope.workspaceId,id).first()
  const branches = await listInboxBranches({ ...scope, includeArchived: true })
  const branch = branches.find(candidate => candidate.id === id)
  if (!branch) throw new Error('Branch not found')
  // A second tab may submit the same restore after the first already won. Treat
  // that replay as success so the action remains safe across devices.
  if (!result && (branch.status === 'archived' || branch.archivedAt)) throw new Error('Archived reply not found')
  return branch
}
