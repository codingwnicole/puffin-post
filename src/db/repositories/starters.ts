import type { WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'

export async function getStarter(scope: WorkspaceScope, id: string): Promise<Starter> {
  await requireMembership(scope.db, scope.userId, scope.workspaceId)
  const starter = await scope.db.prepare(`SELECT id, workspace_id AS workspaceId, character_id AS characterId, rp_group_id AS groupId,
    title, source, root_post_id AS rootPostId, root_blog_id AS rootBlogId, thread_root_id AS threadRootId, thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt
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
  const existing = await db.prepare(`SELECT id, workspace_id AS workspaceId, character_id AS characterId, rp_group_id AS groupId,
    title, source, root_post_id AS rootPostId, root_blog_id AS rootBlogId, thread_root_id AS threadRootId,
    thread_root_blog_id AS threadRootBlogId, description, created_at AS createdAt
    FROM starters WHERE workspace_id = ? AND thread_root_blog_id = ? AND thread_root_id = ?
    AND thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL LIMIT 1`)
    .bind(workspaceId, threadRootBlogId, threadRootId).first<Starter>()
  if (existing) {
    return { ...existing, postUrl: `https://${existing.threadRootBlogId}/post/${existing.threadRootId}` }
  }
  const starter: Starter = {
    id: crypto.randomUUID(), workspaceId, characterId: input.characterId, groupId:input.groupId ?? null, title: input.title.trim(),
    source: 'tumblr', rootPostId: input.rootPostId, rootBlogId: input.rootBlogId, threadRootId, threadRootBlogId, postUrl: `https://${input.rootBlogId}/post/${input.rootPostId}`,
    description: input.description ?? '', createdAt: new Date().toISOString(),
  }
  await db.prepare(`
    INSERT INTO starters (id, workspace_id, character_id, rp_group_id, title, source, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(starter.id, workspaceId, starter.characterId, starter.groupId, starter.title, starter.source,
    starter.rootPostId, starter.rootBlogId, starter.threadRootId, starter.threadRootBlogId, starter.description, starter.createdAt).run()
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
