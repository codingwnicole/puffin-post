import type { Env } from '../worker'

export type Database = Env['DB']

export interface WorkspaceScope {
  db: Database
  userId: string
  workspaceId: string
}
