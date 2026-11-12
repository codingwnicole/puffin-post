import type { WorkspaceScope } from '../db/client'
import { requireMembership } from '../db/repositories/workspaces'

const ALLOWED = new Set(['image/jpeg','image/png','image/webp','image/gif'])
const MAX_BYTES = 2 * 1024 * 1024

export interface IconUploadInput extends WorkspaceScope { characterId:string; file:File }
export interface IconReadInput extends WorkspaceScope { characterId:string }

export async function putCharacterIcon(input: IconUploadInput) {
  await requireMembership(input.db,input.userId,input.workspaceId)
  if (!ALLOWED.has(input.file.type)) throw new Error('unsupported image type')
  if (!input.file.size || input.file.size > MAX_BYTES) throw new Error('icon exceeds 2 MB limit')
  const character = await input.db.prepare('SELECT id,icon_object_key AS iconObjectKey FROM characters WHERE workspace_id=? AND id=?').bind(input.workspaceId,input.characterId).first<{id:string;iconObjectKey:string|null}>()
  if (!character) throw new Error('Character not found')
  const key = `characters/${input.workspaceId}/${input.characterId}/${crypto.randomUUID()}`
  await input.db.prepare('UPDATE characters SET icon_object_key=? WHERE workspace_id=? AND id=?').bind(key,input.workspaceId,input.characterId).run()
  return { objectKey:key, body:input.file.stream(), contentType:input.file.type }
}

export async function getAuthorizedCharacterIcon(input: IconReadInput) {
  await requireMembership(input.db,input.userId,input.workspaceId)
  const character = await input.db.prepare('SELECT icon_object_key AS iconObjectKey FROM characters WHERE workspace_id=? AND id=?').bind(input.workspaceId,input.characterId).first<{iconObjectKey:string|null}>()
  if (!character?.iconObjectKey) throw new Error('not found')
  return character.iconObjectKey
}

export const iconContentTypeAllowed = (type:string) => ALLOWED.has(type)
