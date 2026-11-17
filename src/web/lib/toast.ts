import { useSyncExternalStore } from 'react'
import { api } from './api'

// Tiny app-wide toast with an Undo button. Actions push a toast via `toast()`;
// AppShell renders it once. Undo re-invokes the stored restore, so the server
// state is put back, not just the local UI.
export interface UndoToast {
  id: number
  message: string
  restore: () => Promise<unknown>
}

let current: UndoToast | null = null
let seq = 0
const listeners = new Set<() => void>()

export function toast(message: string, restore: () => Promise<unknown>) {
  current = { id: ++seq, message, restore }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUndoToast(): UndoToast | null {
  return useSyncExternalStore(subscribe, () => current)
}

export function dismissToast() {
  current = null
  for (const listener of listeners) listener()
}

// Re-run the stored restore (POST /restore etc.). Returns a resolved promise so
// the toast can show "Restoring…", then "Couldn't undo" on failure.
export async function restoreToast(t: UndoToast) {
  await t.restore()
}

// Convenience: fire-and-forget the restore, keep the toast for the caller to swap.
export function undoThen(t: UndoToast, done: (ok: boolean) => void) {
  restoreToast(t).then(() => done(true), () => done(false))
}

// Convenience restores for the three undoable actions (all hit the server).
export const undoDismissal = (blogIdentifier: string, postId: string) =>
  () => api('/tumblr-activity/dismissals', 'DELETE', { blogIdentifier, postId })
export const undoStarterArchive = (starterId: string) => () => api(`/starters/${starterId}/restore`, 'POST')
export const undoCharacterArchive = (id: string) => () => api(`/characters/${id}/restore`, 'POST')
export const undoReturnToPlanner = (id: string, state: string, deletePlan: boolean) => () => api(`/character-planner/return-to-cast/${id}`, 'POST', { state, deletePlan })
