import type { Database, WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'

export async function getStarter(scope: WorkspaceScope, id: string): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  const starter = await scope.db.prepare(`SELECT id, workspace_id AS workspaceId, character_id AS characterId, rp_group_id AS groupId,
    title, source, root_post_id AS rootPostId, root_blog_id AS rootBlogId, thread_root_id AS threadRootId, thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt,
    premise, archived, archived_at AS archivedAt,
    title_source AS titleSource, title_confidence AS titleConfidence, title_evidence AS titleEvidence,
    title_manual_override_at AS titleManualOverrideAt, description_source AS descriptionSource,
    description_confidence AS descriptionConfidence, description_evidence AS descriptionEvidence,
    description_manual_override_at AS descriptionManualOverrideAt, premise_source AS premiseSource,
    premise_confidence AS premiseConfidence, premise_evidence AS premiseEvidence,
    premise_manual_override_at AS premiseManualOverrideAt
    FROM starters WHERE workspace_id = ? AND id = ?`).bind(scope.workspaceId,id).first<Starter>()
  if (!starter) throw new Error('Starter not found')
  return starter ? { ...starter, postUrl: `https://${starter.rootBlogId}/post/${starter.rootPostId}` } : starter
}

export interface Starter {
  id: string
  workspaceId: string
  characterId: string
  groupId: string | null
  title: string
  source: 'tumblr'
  rootPostId: string
  rootBlogId: string
  threadRootId: string
  threadRootBlogId: string
  postUrl: string
  description: string
  createdAt: string
  premise: string
  archived: number
  archivedAt: string | null
  titleSource: string
  titleConfidence: string
  titleEvidence: string
  titleManualOverrideAt: string | null
  descriptionSource: string
  descriptionConfidence: string
  descriptionEvidence: string
  descriptionManualOverrideAt: string | null
  premiseSource: string
  premiseConfidence: string
  premiseEvidence: string
  premiseManualOverrideAt: string | null
}

export interface CreateStarterInput extends WorkspaceScope {
  characterId: string
  groupId?: string | null
  title: string
  rootPostId: string
  rootBlogId: string
  threadRootId?: string
  threadRootBlogId?: string
  description?: string
  premise?: string
  titleSource?: string
  titleConfidence?: string
  titleEvidence?: string
  descriptionSource?: string
  descriptionConfidence?: string
  descriptionEvidence?: string
  premiseSource?: string
  premiseConfidence?: string
  premiseEvidence?: string
}

/** The tracked thread any of these post ids belongs to (a starter root, the
 * clicked post, or a branch's latest post). Tumblr post ids are globally
 * unique, so ids alone identify the thread. Null when untracked. */
export async function findTrackedThread(db: Database, workspaceId: string, postIds: string[]): Promise<string | null> {
  const ids = [...new Set(postIds.filter(Boolean))]
  if (!ids.length) return null
  const marks = ids.map(() => '?').join(',')
  const row = await db.prepare(`SELECT s.id FROM starters s WHERE s.workspace_id = ? AND (s.thread_root_id IN (${marks}) OR s.root_post_id IN (${marks})
      OR EXISTS (SELECT 1 FROM reply_branches b WHERE b.workspace_id = s.workspace_id AND b.starter_id = s.id AND b.latest_post_id IN (${marks})))
    ORDER BY s.created_at LIMIT 1`).bind(workspaceId, ...ids, ...ids, ...ids).first<{ id: string }>()
  return row?.id ?? null
}

export async function createStarter(input: CreateStarterInput): Promise<Starter> {
  const { db, userId, workspaceId } = input
  await requireMembership(db, userId, workspaceId)
  const character = await db.prepare('SELECT id FROM characters WHERE workspace_id = ? AND id = ?')
    .bind(workspaceId, input.characterId).first()
  if (!character) throw new Error('Character not found')
  if (!input.title.trim() || !input.rootPostId.trim() || !input.rootBlogId.trim()) {
    throw new Error('Title and Tumblr root identifiers are required')
  }
  // The same Tumblr thread is one scene: re-adding it (an activity ping, a
  // double-click, or the same post surfacing through another character's blog)
  // must find the existing starter instead of forking a second row for it.
  // The partial unique index on (workspace_id, thread_root_blog_id,
  // thread_root_id) guards this for tumblr threads; manual scenes stay
  // link-less and never collide.
  const threadRootId = input.threadRootId ?? input.rootPostId
  const threadRootBlogId = input.threadRootBlogId ?? input.rootBlogId
  const selectStarter = (where: string, params: (string | null)[]) =>
    db.prepare(`SELECT id, workspace_id AS workspaceId, character_id AS characterId, rp_group_id AS groupId,
    title, source, root_post_id AS rootPostId, root_blog_id AS rootBlogId, thread_root_id AS threadRootId,
    thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt, premise, archived, archived_at AS archivedAt,
    title_source AS titleSource, title_confidence AS titleConfidence, title_evidence AS titleEvidence,
    title_manual_override_at AS titleManualOverrideAt, description_source AS descriptionSource,
    description_confidence AS descriptionConfidence, description_evidence AS descriptionEvidence,
    description_manual_override_at AS descriptionManualOverrideAt, premise_source AS premiseSource,
    premise_confidence AS premiseConfidence, premise_evidence AS premiseEvidence,
    premise_manual_override_at AS premiseManualOverrideAt
    FROM starters WHERE ${where} LIMIT 1`).bind(...params).first<Starter>()
  const withPostUrl = (row: Starter) => ({ ...row, postUrl: `https://${row.threadRootBlogId}/post/${row.threadRootId}` })
  const existing = await selectStarter(
    'workspace_id = ? AND thread_root_blog_id = ? AND thread_root_id = ? AND thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL',
    [workspaceId, threadRootBlogId, threadRootId])
  if (existing) return withPostUrl(existing)
  const starter: Starter = {
    id: crypto.randomUUID(), workspaceId, characterId: input.characterId, groupId:input.groupId ?? null, title: input.title.trim(),
    source: 'tumblr', rootPostId: input.rootPostId, rootBlogId: input.rootBlogId, threadRootId, threadRootBlogId, postUrl: `https://${input.rootBlogId}/post/${input.rootPostId}`,
    description: input.description ?? '', createdAt: new Date().toISOString(), premise: input.premise ?? '', archived: 0, archivedAt: null,
    titleSource: input.titleSource ?? 'legacy', titleConfidence: input.titleConfidence ?? 'none', titleEvidence: input.titleEvidence ?? '', titleManualOverrideAt: input.titleSource === 'manual' ? new Date().toISOString() : null,
    descriptionSource: input.descriptionSource ?? 'legacy', descriptionConfidence: input.descriptionConfidence ?? 'none', descriptionEvidence: input.descriptionEvidence ?? '', descriptionManualOverrideAt: input.descriptionSource === 'manual' ? new Date().toISOString() : null,
    premiseSource: input.premiseSource ?? 'legacy', premiseConfidence: input.premiseConfidence ?? 'none', premiseEvidence: input.premiseEvidence ?? '', premiseManualOverrideAt: input.premiseSource === 'manual' ? new Date().toISOString() : null,
  }
  try {
    await db.prepare(`
    INSERT INTO starters (id, workspace_id, character_id, rp_group_id, title, source, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id,
      description, created_at, premise, title_source, title_confidence, title_evidence, description_source, description_confidence, description_evidence,
      premise_source, premise_confidence, premise_evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(starter.id, workspaceId, starter.characterId, starter.groupId, starter.title, starter.source,
    starter.rootPostId, starter.rootBlogId, starter.threadRootId, starter.threadRootBlogId, starter.description, starter.createdAt, starter.premise,
    starter.titleSource, starter.titleConfidence, starter.titleEvidence, starter.descriptionSource, starter.descriptionConfidence, starter.descriptionEvidence,
    starter.premiseSource, starter.premiseConfidence, starter.premiseEvidence).run()
  } catch (error) {
    // A concurrent create of the same thread can slip between the check above and
    // this insert and win the unique index. Return the winner's row, never a 500.
    if (String((error as { message?: string }).message ?? '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
      const winner = await selectStarter('workspace_id = ? AND thread_root_blog_id = ? AND thread_root_id = ?', [workspaceId, threadRootBlogId, threadRootId])
      if (winner) return withPostUrl(winner)
    }
    throw error
  }
  return { ...starter, postUrl: `https://${starter.threadRootBlogId}/post/${starter.threadRootId}` }
}

export async function updateStarterTitle(scope: WorkspaceScope, id: string, title?: string, description?: string): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  if (title === undefined && description === undefined) throw new Error('No starter fields to update')
  if (title !== undefined && !title.trim()) throw new Error('Scene label is required')
  const now = new Date().toISOString()
  const result = await scope.db.prepare(`UPDATE starters SET
    title=CASE WHEN ? THEN ? ELSE title END,
    title_source=CASE WHEN ? THEN 'manual' ELSE title_source END,
    title_confidence=CASE WHEN ? THEN 'high' ELSE title_confidence END,
    title_evidence=CASE WHEN ? THEN 'Edited by the writer' ELSE title_evidence END,
    title_manual_override_at=CASE WHEN ? THEN ? ELSE title_manual_override_at END,
    description=CASE WHEN ? THEN ? ELSE description END,
    premise=CASE WHEN ? THEN ? ELSE premise END,
    description_source=CASE WHEN ? THEN 'manual' ELSE description_source END,
    description_confidence=CASE WHEN ? THEN 'high' ELSE description_confidence END,
    description_evidence=CASE WHEN ? THEN 'Edited by the writer' ELSE description_evidence END,
    description_manual_override_at=CASE WHEN ? THEN ? ELSE description_manual_override_at END,
    premise_source=CASE WHEN ? THEN 'manual' ELSE premise_source END,
    premise_confidence=CASE WHEN ? THEN 'high' ELSE premise_confidence END,
    premise_evidence=CASE WHEN ? THEN 'Edited by the writer' ELSE premise_evidence END,
    premise_manual_override_at=CASE WHEN ? THEN ? ELSE premise_manual_override_at END
    WHERE workspace_id=? AND id=? RETURNING id`)
    .bind(title !== undefined,title?.trim() ?? null,title !== undefined,title !== undefined,title !== undefined,title !== undefined,now,
      description !== undefined,description?.trim() ?? null,description !== undefined,description?.trim() ?? null,
      description !== undefined,description !== undefined,description !== undefined,description !== undefined,now,
      description !== undefined,description !== undefined,description !== undefined,description !== undefined,now,
      scope.workspaceId, id).first()
  if (!result) throw new Error('Starter not found')
  return getStarter(scope, id)
}

/** Refresh parsed values only when a writer has not edited the field. Existing premises stay stable. */
export async function updateAutomaticStarterFields(scope: WorkspaceScope, id: string, input: {
  title?: string | null; titleSource?: string; titleConfidence?: string; titleEvidence?: string | null
  description?: string | null; descriptionSource?: string; descriptionConfidence?: string; descriptionEvidence?: string | null
  premise?: string | null; premiseSource?: string; premiseConfidence?: string; premiseEvidence?: string | null
}): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  await scope.db.prepare(`UPDATE starters SET
    title=CASE WHEN title_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE title END,
    title_source=CASE WHEN title_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE title_source END,
    title_confidence=CASE WHEN title_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE title_confidence END,
    title_evidence=CASE WHEN title_manual_override_at IS NULL AND ? IS NOT NULL THEN ? ELSE title_evidence END,
    description=CASE WHEN description_manual_override_at IS NULL AND description='' AND ? IS NOT NULL THEN ? ELSE description END,
    description_source=CASE WHEN description_manual_override_at IS NULL AND description='' AND ? IS NOT NULL THEN ? ELSE description_source END,
    description_confidence=CASE WHEN description_manual_override_at IS NULL AND description='' AND ? IS NOT NULL THEN ? ELSE description_confidence END,
    description_evidence=CASE WHEN description_manual_override_at IS NULL AND description='' AND ? IS NOT NULL THEN ? ELSE description_evidence END,
    premise=CASE WHEN premise_manual_override_at IS NULL AND premise='' AND ? IS NOT NULL THEN ? ELSE premise END,
    premise_source=CASE WHEN premise_manual_override_at IS NULL AND premise='' AND ? IS NOT NULL THEN ? ELSE premise_source END,
    premise_confidence=CASE WHEN premise_manual_override_at IS NULL AND premise='' AND ? IS NOT NULL THEN ? ELSE premise_confidence END,
    premise_evidence=CASE WHEN premise_manual_override_at IS NULL AND premise='' AND ? IS NOT NULL THEN ? ELSE premise_evidence END
    WHERE workspace_id=? AND id=?`)
    .bind(input.title ?? null, input.title ?? null, input.title ?? null, input.titleSource ?? 'unresolved', input.title ?? null, input.titleConfidence ?? 'none', input.title ?? null, input.titleEvidence ?? '',
      input.description ?? null, input.description ?? null, input.description ?? null, input.descriptionSource ?? 'unresolved', input.description ?? null, input.descriptionConfidence ?? 'none', input.description ?? null, input.descriptionEvidence ?? '',
      input.premise ?? null, input.premise ?? null, input.premise ?? null, input.premiseSource ?? 'unresolved', input.premise ?? null, input.premiseConfidence ?? 'none', input.premise ?? null, input.premiseEvidence ?? '',
      scope.workspaceId, id).run()
  return getStarter(scope, id)
}
