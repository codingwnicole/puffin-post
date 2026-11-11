import type { WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'

export interface Starter {
  id: string
  workspaceId: string
  characterId: string
  title: string
  source: 'tumblr'
  rootPostId: string
  rootBlogId: string
  description: string
  createdAt: string
}

export interface CreateStarterInput extends WorkspaceScope {
  characterId: string
  title: string
  rootPostId: string
  rootBlogId: string
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
  const starter: Starter = {
    id: crypto.randomUUID(), workspaceId, characterId: input.characterId, title: input.title.trim(),
    source: 'tumblr', rootPostId: input.rootPostId, rootBlogId: input.rootBlogId,
    description: input.description ?? '', createdAt: new Date().toISOString(),
  }
  await db.prepare(`
    INSERT INTO starters (id, workspace_id, character_id, title, source, root_post_id, root_blog_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(starter.id, workspaceId, starter.characterId, starter.title, starter.source,
    starter.rootPostId, starter.rootBlogId, starter.description, starter.createdAt).run()
  return starter
}
