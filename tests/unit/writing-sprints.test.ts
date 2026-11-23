import { describe, expect, it } from 'vitest'
import { countWords, creditedWordCount, sprintTotals, updateCreditMask, type ReplySegment } from '../../src/shared/writing-sprints'
import { SprintRoom } from '../../src/sprints/room'

function segment(overrides: Partial<ReplySegment> = {}): ReplySegment {
  return {
    id: 'reply-1', title: '', text: '', creditMask: '', completedAt: null, creditedSnapshot: null,
    collapsed: false, characterId: null, starterId: null, parkingLotDraftId: null, ...overrides,
  }
}

describe('writing sprint word credit', () => {
  it('counts whitespace-delimited words in separate reply editors', () => {
    expect(countWords('  one\n two\tthree ')).toBe(3)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('credits words typed while the timer runs and excludes pasted text', () => {
    const typed = updateCreditMask('', '', 'typed words', 'insertText', true)
    const pasted = updateCreditMask('', '', 'pasted words', 'insertFromPaste', true)
    expect(creditedWordCount('typed words', typed)).toBe(2)
    expect(creditedWordCount('pasted words', pasted)).toBe(0)
  })

  it('does not credit typing before or after a timer is active', () => {
    const before = updateCreditMask('', '', 'before timer', 'insertText', false)
    const after = updateCreditMask('', '', ' after', 'insertText', false)
    expect(creditedWordCount('before timer', before)).toBe(0)
    expect(creditedWordCount(' after', after)).toBe(0)
  })

  it('preserves authored characters when later edits add text elsewhere', () => {
    const first = updateCreditMask('', '', 'one two', 'insertText', true)
    const edited = updateCreditMask('one two', first, 'one pasted two', 'insertFromPaste', true)
    expect(creditedWordCount('one pasted two', edited)).toBe(2)
  })

  it('keeps a completed word snapshot when the reply text is cleared', () => {
    const completed = segment({ text: 'reply words', creditMask: '11111111111', completedAt: '2026-11-23T00:00:00.000Z', creditedSnapshot: 2 })
    const cleared = { ...completed, text: '', creditMask: '' }
    expect(sprintTotals([cleared])).toEqual({ editorWords: 0, creditedWords: 2, repliesCompleted: 1 })
  })

  it('aggregates reply count and credited words without merging reply text', () => {
    const replies = [
      segment({ id: 'one', text: 'first reply', creditMask: '11111111111', completedAt: '2026-11-23T00:00:00.000Z', creditedSnapshot: 2 }),
      segment({ id: 'two', text: 'second reply', creditMask: '111111111111' }),
    ]
    expect(sprintTotals(replies)).toEqual({ editorWords: 4, creditedWords: 4, repliesCompleted: 1 })
  })
})

describe('sprint room pending sockets', () => {
  function fakeRoom(sockets: Array<{ openedAt: number; closed?: number }>) {
    const room = { appOrigin: 'https://app.test', expiresAt: Date.now() + 60_000, participantLimit: 2 }
    const live = sockets.map(state => ({
      deserializeAttachment: () => ({ authenticated: false, openedAt: state.openedAt }),
      close: (code: number) => { state.closed = code },
    }))
    const ctx = { storage: { get: async () => room }, getWebSockets: () => live, acceptWebSocket: () => undefined }
    return new SprintRoom(ctx as unknown as DurableObjectState, {} as never)
  }
  const request = () => new Request('https://room.internal/socket', { headers: { origin: 'https://app.test', upgrade: 'websocket' } })

  it('refuses new sockets while fresh unauthenticated ones fill the pending slots', async () => {
    const sockets = Array.from({ length: 6 }, (): { openedAt: number; closed?: number } => ({ openedAt: Date.now() }))
    expect((await fakeRoom(sockets).fetch(request())).status).toBe(429)
    expect(sockets.every(socket => socket.closed === undefined)).toBe(true)
  })

  it('closes stale unauthenticated sockets so they cannot hold the room', async () => {
    const sockets = Array.from({ length: 6 }, (): { openedAt: number; closed?: number } => ({ openedAt: Date.now() - 60_000 }))
    const original = (globalThis as { WebSocketPair?: unknown }).WebSocketPair
    ;(globalThis as { WebSocketPair?: unknown }).WebSocketPair = class { 0 = {}; 1 = { serializeAttachment: () => undefined } }
    const OriginalResponse = globalThis.Response
    // Node's Response rejects status 101; record the upgrade instead.
    globalThis.Response = class extends OriginalResponse { constructor(body: BodyInit | null, init?: ResponseInit) { super(body, init?.status === 101 ? { status: 200 } : init) } } as typeof Response
    try {
      expect((await fakeRoom(sockets).fetch(request())).status).toBe(200)
    } finally {
      ;(globalThis as { WebSocketPair?: unknown }).WebSocketPair = original
      globalThis.Response = OriginalResponse
    }
    expect(sockets.every(socket => socket.closed === 1008)).toBe(true)
  })
})
