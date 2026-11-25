export interface SprintAggregate { words: number; replies: number; sessions: number }
export interface SprintStats { timezone: string; today: SprintAggregate; thisWeek: SprintAggregate; allTime: SprintAggregate; mostRecent: { words: number; replies: number; endedAt: string; title: string } | null }
export interface SprintRow { wordsCredited: number; repliesCompleted: number; endedAt: string; title: string }

function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }

/** Validate API data before the sidebar renders it; stale or incomplete responses must not crash the app shell. */
export function isSprintStats(value: unknown): value is SprintStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const stats = value as Record<string, unknown>
  const isAggregate = (entry: unknown): entry is SprintAggregate => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const aggregate = entry as Record<string, unknown>
    return isCount(aggregate.words) && isCount(aggregate.replies) && isCount(aggregate.sessions)
  }
  const recent = stats.mostRecent
  const isRecent = recent === null || (
    Boolean(recent) && typeof recent === 'object' && !Array.isArray(recent) &&
    isCount((recent as Record<string, unknown>).words) &&
    isCount((recent as Record<string, unknown>).replies) &&
    typeof (recent as Record<string, unknown>).endedAt === 'string' &&
    typeof (recent as Record<string, unknown>).title === 'string'
  )
  return typeof stats.timezone === 'string' && isAggregate(stats.today) && isAggregate(stats.thisWeek) && isAggregate(stats.allTime) && isRecent
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) }
}

/** Convert a wall-clock time in an IANA zone to UTC without assuming a fixed
 * offset. Iteration handles daylight saving transitions at calendar boundaries. */
export function localWallTimeToUtc(parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, timeZone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
  let guess = target
  const seen: number[] = []
  for (let attempt = 0; attempt < 5; attempt++) {
    if (seen.includes(guess)) break
    seen.push(guess)
    const actual = zonedParts(new Date(guess), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const correction = target - represented
    guess += correction
    if (correction === 0) break
  }
  // A wall time can be skipped when clocks move forward. In that case the
  // offset iteration oscillates; choose the nearest representable local time
  // after the requested time (for example 03:30 for a missing 02:30).
  if (seen.includes(guess)) {
    const candidates = [...seen, guess].map(value => {
      const actual = zonedParts(new Date(value), timeZone)
      const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
      return { value, delta: represented - target }
    }).filter(candidate => candidate.delta >= 0).sort((a, b) => a.delta - b.delta)
    if (candidates[0]) guess = candidates[0].value
  }
  return new Date(guess)
}

/** Add calendar days in the supplied zone, preserving local wall time across DST. */
export function calendarDaysAfter(value: string, days: number, timeZone: string): string {
  const local = zonedParts(new Date(value), timeZone)
  const target = new Date(Date.UTC(local.year, local.month - 1, local.day))
  target.setUTCDate(target.getUTCDate() + days)
  return localWallTimeToUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(), hour: local.hour, minute: local.minute, second: local.second }, timeZone).toISOString()
}

export function sprintStatsBoundaries(now: Date, timeZone: string) {
  const local = zonedParts(now, timeZone)
  const todayStart = localWallTimeToUtc({ year: local.year, month: local.month, day: local.day }, timeZone)
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const daysFromMonday = (localDate.getUTCDay() + 6) % 7
  localDate.setUTCDate(localDate.getUTCDate() - daysFromMonday)
  const weekStart = localWallTimeToUtc({ year: localDate.getUTCFullYear(), month: localDate.getUTCMonth() + 1, day: localDate.getUTCDate() }, timeZone)
  return { todayStart: todayStart.toISOString(), weekStart: weekStart.toISOString(), now: now.toISOString() }
}

export function summarizeSoloSprints(rows: SprintRow[], now: Date, timeZone: string): SprintStats {
  const { todayStart, weekStart } = sprintStatsBoundaries(now, timeZone)
  const completed = rows.filter(row => Date.parse(row.endedAt) <= now.getTime())
  const aggregate = (items: SprintRow[]): SprintAggregate => items.reduce((sum, row) => ({ words: sum.words + row.wordsCredited, replies: sum.replies + row.repliesCompleted, sessions: sum.sessions + 1 }), { words: 0, replies: 0, sessions: 0 })
  const today = completed.filter(row => row.endedAt >= todayStart)
  const week = completed.filter(row => row.endedAt >= weekStart)
  const recent = [...completed].sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0]
  return { timezone: timeZone, today: aggregate(today), thisWeek: aggregate(week), allTime: aggregate(completed), mostRecent: recent ? { words: recent.wordsCredited, replies: recent.repliesCompleted, endedAt: recent.endedAt, title: recent.title } : null }
}
