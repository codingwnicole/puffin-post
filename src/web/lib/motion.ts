import { useEffect, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

// Entrance animations (CSS `rise` with --i stagger) should play once, when the list first
// appears, not again every time a reload re-renders it. Pass `ready` = "the list is on screen"
// and put `data-entered={entered ? '' : undefined}` on its container; styles.css turns the child
// animations off once the attribute is set.
export function useEntered(ready = true, delay = 700) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!ready || entered) return
    const timer = window.setTimeout(() => setEntered(true), delay)
    return () => window.clearTimeout(timer)
  }, [ready, entered, delay])
  return entered
}

// Scene moves: when a scene's turn changes it leaves one section and lands in another (Owed now <-> the RP groups).
// While a move runs, every scene card carries a view-transition name so the browser glides the moved card to its new
// place and the others close the gap. Same View Transitions API as page swaps in App.tsx; no animation library.
// The update must commit its DOM change before its promise resolves (InboxPage's reload uses flushSync), or the
// browser snapshots the old list and the change simply appears without the glide.
let sceneMoving = false
const sceneListeners = new Set<() => void>()
function setSceneMoving(value: boolean) { sceneMoving = value; sceneListeners.forEach(listener => listener()) }
export function useSceneMoving() {
  return useSyncExternalStore(listener => { sceneListeners.add(listener); return () => { sceneListeners.delete(listener) } }, () => sceneMoving)
}
export async function runSceneMove(update: () => Promise<void>) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduce) { await update(); return }
  flushSync(() => setSceneMoving(true)) // the old snapshot must already carry the names
  document.documentElement.dataset.vt = 'scene'
  const transition = document.startViewTransition(update)
  transition.ready.catch(() => undefined)
  try { await transition.updateCallbackDone; await transition.finished.catch(() => undefined) }
  finally { delete document.documentElement.dataset.vt; setSceneMoving(false) }
}
