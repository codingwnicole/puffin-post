import { describe, expect, it } from 'vitest'
import { advance, breakMinutes, initialFocus, parseFocus, pause, resume, setLength, start, stop, timeLeft } from '../../src/web/lib/focus'

const MIN = 60_000

describe('focus cycles', () => {
  it('runs focus, then a 5 minute break, then returns to ready', () => {
    let s = start({ ...initialFocus(), link: { id: 'b1', title: 'Harbor at dusk' } }, 0)
    expect(s.phase).toBe('focus')
    expect(advance(s, 24 * MIN)).toBe(s)
    s = advance(s, 25 * MIN)
    expect(s).toMatchObject({ phase: 'break', completed: 1, justFinished: true, endsAt: 30 * MIN })
    expect(s.history[0]).toEqual({ title: 'Harbor at dusk', minutes: 25, endedAt: 25 * MIN })
    s = advance(s, 30 * MIN)
    expect(s).toMatchObject({ phase: 'idle', endsAt: null, completed: 1, justFinished: false })
  })

  it('gives a 15 minute break after every fourth session and starts the count again', () => {
    expect([1, 2, 3, 4, 5, 8].map(breakMinutes)).toEqual([5, 5, 5, 15, 5, 15])
    let s = { ...initialFocus(), completed: 3 }
    s = advance(start(s, 0), 25 * MIN)
    expect(s.completed).toBe(4)
    expect(timeLeft(s, 25 * MIN)).toBe(15 * MIN)
    expect(advance(s, 40 * MIN).completed).toBe(0)
  })

  it('pauses and resumes without losing time, and stop does not count the session', () => {
    let s = pause(start(initialFocus(), 0), 10 * MIN)
    expect(timeLeft(s, 99 * MIN)).toBe(15 * MIN)
    s = resume(s, 100 * MIN)
    expect(s.endsAt).toBe(115 * MIN)
    expect(stop(s)).toMatchObject({ phase: 'idle', completed: 0, history: [] })
  })

  it('only changes length while ready', () => {
    expect(setLength(initialFocus(), 50).remainingMs).toBe(50 * MIN)
    const running = start(initialFocus(), 0)
    expect(setLength(running, 50)).toBe(running)
  })

  it.each(['{', 'null', '{"phase":"nap","lengthMin":25}', '{"phase":"focus","lengthMin":7}'])('ignores bad saved state: %s', raw => {
    expect(parseFocus(raw)).toEqual(initialFocus())
  })

  it('restores a running cycle from storage', () => {
    const saved = start({ ...initialFocus(), link: { id: 'x', title: 'T' } }, 1000)
    expect(parseFocus(JSON.stringify(saved))).toEqual(saved)
  })
})
