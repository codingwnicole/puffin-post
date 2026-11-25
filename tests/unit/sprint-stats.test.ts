import { describe, expect, it } from 'vitest'
import { calendarDaysAfter, sprintStatsBoundaries, summarizeSoloSprints } from '../../src/shared/sprint-stats'

describe('persisted sprint statistics', () => {
  it('uses local calendar boundaries across daylight-saving changes', () => {
    const bounds = sprintStatsBoundaries(new Date('2026-03-09T15:00:00.000Z'), 'America/Chicago')
    expect(bounds.todayStart).toBe('2026-03-09T05:00:00.000Z')
    expect(bounds.weekStart).toBe('2026-03-09T05:00:00.000Z')
  })

  it('adds activity intervals as calendar days in the chosen time zone', () => {
    // 02:30 is skipped by the spring-forward transition in Chicago; the due
    // time moves to the next representable wall time, 03:30 local.
    expect(calendarDaysAfter('2026-03-07T08:30:00.000Z', 1, 'America/Chicago')).toBe('2026-03-08T08:30:00.000Z')
  })

  it('counts completed saved totals and excludes future sessions', () => {
    const stats = summarizeSoloSprints([
      { title: 'Morning replies', wordsCredited: 850, repliesCompleted: 2, endedAt: '2026-11-25T14:00:00.000Z' },
      { title: 'Earlier sprint', wordsCredited: 400, repliesCompleted: 1, endedAt: '2026-11-23T16:00:00.000Z' },
      { title: 'Future row', wordsCredited: 900, repliesCompleted: 4, endedAt: '2026-11-26T14:00:00.000Z' },
    ], new Date('2026-11-25T18:00:00.000Z'), 'America/Chicago')
    expect(stats.today.words).toBe(850)
    expect(stats.thisWeek.words).toBe(1250)
    expect(stats.allTime).toEqual({ words: 1250, replies: 3, sessions: 2 })
    expect(stats.mostRecent?.title).toBe('Morning replies')
  })
})
