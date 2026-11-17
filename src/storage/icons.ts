import { HTTPException } from 'hono/http-exception'
import type { WorkspaceScope } from '../db/client'
import { requireMembership } from '../db/repositories/workspaces'

const ALLOWED = new Set(['image/jpeg','image/png','image/webp'])
const MAX_BYTES = 2 * 1024 * 1024

export interface IconUploadInput extends WorkspaceScope { characterId:string; file:File }
export interface IconReadInput extends WorkspaceScope { characterId:string }

export async function putCharacterIcon(input: IconUploadInput) {
  await requireMembership(input.db,input.userId,input.workspaceId)
  if (!ALLOWED.has(input.file.type)) throw new HTTPException(415,{message:'unsupported image type'})
  if (!input.file.size || input.file.size > MAX_BYTES) throw new HTTPException(413,{message:'Icon exceeds 2 MB limit'})
  const character = await input.db.prepare('SELECT id,icon_object_key AS iconObjectKey FROM characters WHERE workspace_id=? AND id=?').bind(input.workspaceId,input.characterId).first<{id:string;iconObjectKey:string|null}>()
  if (!character) throw new HTTPException(404,{message:'Character not found'})
  const contentType = await validatedRasterType(input.file)
  const key = `characters/${input.workspaceId}/${input.characterId}/${crypto.randomUUID()}`
  return { objectKey:key, previousObjectKey:character.iconObjectKey, body:input.file.stream(), contentType }
}

export async function getAuthorizedCharacterIcon(input: IconReadInput) {
  await requireMembership(input.db,input.userId,input.workspaceId)
  const character = await input.db.prepare('SELECT icon_object_key AS iconObjectKey FROM characters WHERE workspace_id=? AND id=?').bind(input.workspaceId,input.characterId).first<{iconObjectKey:string|null}>()
  if (!character?.iconObjectKey) throw new HTTPException(404,{message:'not found'})
  return character.iconObjectKey
}

export const iconContentTypeAllowed = (type:string) => ALLOWED.has(type)

export async function validatedRasterType(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const matches = (...signature:number[]) => signature.every((value,index) => bytes[index] === value)
  if (matches(0xff,0xd8,0xff)) return 'image/jpeg'
  if (matches(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)) return 'image/png'
  if (matches(0x52,0x49,0x46,0x46) && matchesAt(bytes,8,0x57,0x45,0x42,0x50)) return 'image/webp'
  throw new HTTPException(415,{message:'unsupported image type'})
}
function matchesAt(bytes:Uint8Array, start:number, ...signature:number[]) { return signature.every((value,index)=>bytes[start+index]===value) }
