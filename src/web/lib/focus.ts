import { useSyncExternalStore } from 'react'

// Focus cycles: the solo-sprint timer plus breaks (5 minutes, 15 after every fourth session) and a linked scene.
// State lives in this browser only (like sprint drafts); nothing is uploaded. Time is kept as an end timestamp,
// so the cycle keeps running while you are on other pages or the tab sleeps. One store, shared by the Focus page
// and the desk rail (same useSyncExternalStore pattern as lib/toast.ts).

export const FOCUS_LENGTHS = [15, 25, 50] as const
export type FocusPhase = 'idle' | 'focus' | 'break'
export interface FocusSession { title: string; minutes: number; endedAt: number }
export interface FocusState {
  phase: FocusPhase
  lengthMin: number
  /** Running: when the phase ends. Null while idle or paused. */
  endsAt: number | null
  /** Paused: time left. */
  remainingMs: number
  /** Focus sessions finished in this cycle of four. */
  completed: number
  link: { id: string; title: string } | null
  /** Set when a focus session ends; the page plays the bloom once and clears it. */
  justFinished: boolean
  history: FocusSession[]
}

const KEY = 'puffin-post.focus'
const HISTORY = 8
export const initialFocus = (): FocusState => ({ phase: 'idle', lengthMin: 25, endsAt: null, remainingMs: 25 * 60_000, completed: 0, link: null, justFinished: false, history: [] })
export const breakMinutes = (completed: number) => completed > 0 && completed % 4 === 0 ? 15 : 5
export const isPaused = (s: FocusState) => s.phase !== 'idle' && s.endsAt === null
export const timeLeft = (s: FocusState, now: number) => s.endsAt === null ? s.remainingMs : Math.max(0, s.endsAt - now)
export const phaseLength = (s: FocusState) => (s.phase === 'break' ? breakMinutes(s.completed) : s.lengthMin) * 60_000

// ---- pure transitions (unit-tested) ----
export function start(s: FocusState, now: number): FocusState {
  return { ...s, phase: 'focus', endsAt: now + s.lengthMin * 60_000, remainingMs: s.lengthMin * 60_000, justFinished: false }
}
export function pause(s: FocusState, now: number): FocusState {
  return s.endsAt === null ? s : { ...s, endsAt: null, remainingMs: timeLeft(s, now) }
}
export function resume(s: FocusState, now: number): FocusState {
  return isPaused(s) ? { ...s, endsAt: now + s.remainingMs } : s
}
/** Back to ready. Keeps the linked scene, length and history; a stopped session is not counted. */
export function stop(s: FocusState): FocusState {
  return { ...s, phase: 'idle', endsAt: null, remainingMs: s.lengthMin * 60_000, justFinished: false }
}
export function setLength(s: FocusState, minutes: number): FocusState {
  return s.phase === 'idle' ? { ...s, lengthMin: minutes, remainingMs: minutes * 60_000 } : s
}
/** Moves the cycle on when the running phase has ended: focus -> break (starts at once) -> ready. */
export function advance(s: FocusState, now: number): FocusState {
  if (s.endsAt === null || now < s.endsAt) return s
  if (s.phase === 'focus') {
    const completed = s.completed + 1
    const session = { title: s.link?.title ?? 'Free writing', minutes: s.lengthMin, endedAt: s.endsAt }
    const breakMs = breakMinutes(completed) * 60_000
    return { ...s, phase: 'break', completed, endsAt: s.endsAt + breakMs, remainingMs: breakMs, justFinished: true, history: [session, ...s.history].slice(0, HISTORY) }
  }
  return { ...s, phase: 'idle', endsAt: null, remainingMs: s.lengthMin * 60_000, completed: s.completed % 4, justFinished: false }
}

// ---- storage ----
export function parseFocus(raw: string | null): FocusState {
  try {
    const v = JSON.parse(raw ?? 'null')
    if (!v || typeof v !== 'object' || !['idle', 'focus', 'break'].includes(v.phase) || !FOCUS_LENGTHS.includes(v.lengthMin)) return initialFocus()
    const num = (x: unknown, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? x : fallback
    const link = v.link && typeof v.link.id === 'string' && typeof v.link.title === 'string' ? { id: v.link.id, title: v.link.title.slice(0, 200) } : null
    const history = Array.isArray(v.history) ? v.history.filter((h: FocusSession) => h && typeof h.title === 'string' && typeof h.minutes === 'number' && typeof h.endedAt === 'number').slice(0, HISTORY) : []
    return { phase: v.phase, lengthMin: v.lengthMin, endsAt: v.endsAt === null ? null : num(v.endsAt, Date.now()), remainingMs: num(v.remainingMs, v.lengthMin * 60_000), completed: Math.max(0, Math.floor(num(v.completed, 0))) % 4, link, justFinished: v.justFinished === true, history }
  } catch { return initialFocus() }
}

let state: FocusState | null = null
const listeners = new Set<() => void>()
let ticker: number | undefined

function read(): FocusState {
  if (state) return state
  let raw: string | null = null
  try { raw = window.localStorage.getItem(KEY) } catch { /* blocked storage: start fresh */ }
  state = advanceAll(parseFocus(raw), Date.now())
  syncTicker()
  return state
}
/** A tab asleep for an hour may have missed a focus end and a break end. */
function advanceAll(s: FocusState, now: number): FocusState {
  for (let next = advance(s, now); next !== s; next = advance(s, now)) s = next
  return s
}
function syncTicker() {
  const running = state?.endsAt != null
  if (running && ticker === undefined) ticker = window.setInterval(() => update(s => advanceAll(s, Date.now()), true), 1000)
  if (!running && ticker !== undefined) { window.clearInterval(ticker); ticker = undefined }
}

/** `tick` updates notify every second so clocks repaint; storage writes only when the state changes. */
export function update(change: (s: FocusState) => FocusState, tick = false) {
  const before = read(), after = change(before)
  if (after !== before) {
    state = after
    try { window.localStorage.setItem(KEY, JSON.stringify(after)) } catch { /* the cycle still runs this session */ }
    syncTicker()
  } else if (!tick) return
  snapshot++
  for (const listener of listeners) listener()
}

let snapshot = 0
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** Re-renders every second while the timer runs (snapshot counter), not just on state changes. */
export function useFocus(): [FocusState, number] {
  useSyncExternalStore(subscribe, () => snapshot)
  return [read(), Date.now()]
}
