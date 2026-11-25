import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { isSprintStats, type SprintStats as Stats } from '../../shared/sprint-stats'

export default function SprintStats({ compact = false }: { compact?: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    void api<Stats>(`/sprints/stats?timezone=${encodeURIComponent(timezone)}`)
      .then(value => {
        if (!isSprintStats(value)) throw new Error('The server returned incomplete sprint totals.')
        if (active) setStats(value)
      })
      .catch(problem => { if (active) setError((problem as Error).message || 'Saved sprint totals could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return <section className={`tracking-card sprint-stats-widget${compact ? ' is-compact' : ''}`} aria-label="Writing statistics">
    <details>
      <summary>Writing statistics <span className="field-help">Sprint words</span></summary>
      {loading ? <p className="field-help" role="status">Loading saved sprint totals.</p>
        : error ? <p className="field-help" role="status">Saved sprint totals are unavailable right now. {error}</p>
          : stats && <>
            <div className="sprint-stats-grid">
              <div><strong>{stats.today.words.toLocaleString()}</strong><span>Today</span></div>
              <div><strong>{stats.thisWeek.words.toLocaleString()}</strong><span>This week</span></div>
              <div><strong>{stats.allTime.words.toLocaleString()}</strong><span>All time</span></div>
            </div>
            <p className="field-help">{stats.today.replies.toLocaleString()} replies today · {stats.thisWeek.replies.toLocaleString()} this week</p>
            <p className="field-help">{stats.mostRecent
              ? `Last sprint: ${stats.mostRecent.words.toLocaleString()} words · ${stats.mostRecent.replies.toLocaleString()} replies`
              : 'Finish a sprint to start your writing history.'}</p>
          </>}
      <a className="text-button" href="#tools/sprints">View sprint history</a>
    </details>
  </section>
}
