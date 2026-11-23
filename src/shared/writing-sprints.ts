export const SPRINT_PRESETS = [5, 10, 15, 25, 45, 60] as const

export type SprintKind = 'solo' | 'room'
export type SprintPhase = 'ready' | 'running' | 'paused' | 'finished'

export interface ReplySegment {
  id: string
  title: string
  text: string
  creditMask: string
  completedAt: string | null
  creditedSnapshot: number | null
  collapsed: boolean
  characterId: string | null
  starterId: string | null
  parkingLotDraftId: string | null
}

export interface LocalSprint {
  id: string
  kind: SprintKind
  roomId?: string
  participantId?: string
  roundNumber?: number
  title: string
  durationSeconds: number
  goalWords: number | null
  phase: SprintPhase
  startedAt: string | null
  endedAt: string | null
  deadlineAt: number | null
  remainingMs: number
  segments: ReplySegment[]
  historySavedAt: string | null
  createdAt: string
  updatedAt: string
}

export function countWords(text: string): number {
  return text.trim() ? Array.from(text.matchAll(/\S+/gu)).length : 0
}

// Only words whose non-whitespace characters were typed while the timer ran
// count as sprint work. Pasted/imported words keep a zero mask.
export function creditedWordCount(text: string, mask: string): number {
  let count = 0
  for (const match of text.matchAll(/\S+/gu)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (mask.slice(start, end).length === end - start && /^1+$/u.test(mask.slice(start, end))) count++
  }
  return count
}

export function updateCreditMask(oldText: string, oldMask: string, nextText: string, inputType: string, timerRunning: boolean): string {
  let prefix = 0
  const shared = Math.min(oldText.length, nextText.length)
  while (prefix < shared && oldText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (suffix < oldText.length - prefix && suffix < nextText.length - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === nextText.charCodeAt(nextText.length - 1 - suffix)) suffix++

  const mask = oldMask.slice(0, oldText.length).padEnd(oldText.length, '0')
  const insertedLength = nextText.length - prefix - suffix
  const authoredInput = timerRunning && /^(insertText|insertReplacementText|insertCompositionText|insertLineBreak|insertParagraph)$/u.test(inputType)
  return mask.slice(0, prefix) + (authoredInput ? '1' : '0').repeat(insertedLength) + mask.slice(oldText.length - suffix)
}

export function sprintTotals(segments: ReplySegment[]) {
  return segments.reduce((totals, segment) => {
    totals.editorWords += countWords(segment.text)
    totals.creditedWords += segment.completedAt
      ? segment.creditedSnapshot ?? 0
      : creditedWordCount(segment.text, segment.creditMask)
    if (segment.completedAt) totals.repliesCompleted++
    return totals
  }, { editorWords: 0, creditedWords: 0, repliesCompleted: 0 })
}

export function makeReplySegment(): ReplySegment {
  return {
    id: crypto.randomUUID(), title: '', text: '', creditMask: '', completedAt: null,
    creditedSnapshot: null, collapsed: false, characterId: null, starterId: null,
    parkingLotDraftId: null,
  }
}
