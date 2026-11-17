import type { Database, WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'

export async function getStarter(scope: WorkspaceScope, id: string): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  const starter = await scope.db.prepare(`SELECT id, workspace_id AS workspaceId, character_id AS characterId, rp_group_id AS groupId,
    title, source, root_post_id AS rootPostId, root_blog_id AS rootBlogId, thread_root_id AS threadRootId, thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt,
    premise, archived, archived_at AS archivedAt
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
    thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt
    FROM starters WHERE ${where} LIMIT 1`).bind(...params).first<Starter>()
  const withPostUrl = (row: Starter) => ({ ...row, postUrl: `https://${row.threadRootBlogId}/post/${row.threadRootId}` })
  const existing = await selectStarter(
    'workspace_id = ? AND thread_root_blog_id = ? AND thread_root_id = ? AND thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL',
    [workspaceId, threadRootBlogId, threadRootId])
  if (existing) return withPostUrl(existing)
  const starter: Starter = {
    id: crypto.randomUUID(), workspaceId, characterId: input.characterId, groupId:input.groupId ?? null, title: input.title.trim(),
    source: 'tumblr', rootPostId: input.rootPostId, rootBlogId: input.rootBlogId, threadRootId, threadRootBlogId, postUrl: `https://${input.rootBlogId}/post/${input.rootPostId}`,
    description: input.description ?? '', createdAt: new Date().toISOString(), premise: '', archived: 0, archivedAt: null,
  }
  try {
    await db.prepare(`
    INSERT INTO starters (id, workspace_id, character_id, rp_group_id, title, source, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(starter.id, workspaceId, starter.characterId, starter.groupId, starter.title, starter.source,
    starter.rootPostId, starter.rootBlogId, starter.threadRootId, starter.threadRootBlogId, starter.description, starter.createdAt).run()
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

export async function updateStarterTitle(scope: WorkspaceScope, id: string, title: string, description: string): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  if (!title.trim()) throw new Error('Scene label is required')
  const result = await scope.db.prepare('UPDATE starters SET title=?, description=? WHERE workspace_id=? AND id=? RETURNING id')
    .bind(title.trim(), description.trim(), scope.workspaceId, id).first()
  if (!result) throw new Error('Starter not found')
  return getStarter(scope, id)
}
