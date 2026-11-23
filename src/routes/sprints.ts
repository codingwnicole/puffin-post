import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { checkRateLimit } from '../auth/rate-limits'
import type { Env } from '../worker'

const resultSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9:_-]+$/u),
  title: z.string().trim().max(120).transform(value => value || 'Writing sprint'),
  kind: z.enum(['solo', 'room']),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().int().min(0).max(21_600),
  wordsCredited: z.number().int().min(0).max(1_000_000),
  repliesCompleted: z.number().int().min(0).max(100_000),
  goalWords: z.number().int().min(1).max(1_000_000).nullable(),
  participantCount: z.number().int().min(1).max(32).default(1),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.endedAt) < Date.parse(value.startedAt)) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'End time must follow start time' })
  }
})

export function sprintRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50))
    const result = await scope.db.prepare(`
      SELECT id,title,kind,started_at AS startedAt,ended_at AS endedAt,
        duration_seconds AS durationSeconds,words_credited AS wordsCredited,
        replies_completed AS repliesCompleted,goal_words AS goalWords,
        participant_count AS participantCount
      FROM writing_sprints WHERE workspace_id=? ORDER BY ended_at DESC LIMIT ?
    `).bind(scope.workspaceId, limit).all()
    return c.json(result.results)
  })

  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const gate = await checkRateLimit(scope.db, `sprint-history:${scope.workspaceId}`, 60, 24 * 60 * 60_000)
    if (!gate.allowed) throw new HTTPException(429, { message: 'Sprint history is saving too often. Try again tomorrow.' })
    const input = resultSchema.parse(await c.req.json())
    const now = new Date().toISOString()
    const saved = await scope.db.prepare(`
      INSERT OR IGNORE INTO writing_sprints
        (id,workspace_id,title,kind,started_at,ended_at,duration_seconds,words_credited,replies_completed,goal_words,participant_count,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(input.id, scope.workspaceId, input.title, input.kind, input.startedAt, input.endedAt,
      input.durationSeconds, input.wordsCredited, input.repliesCompleted, input.goalWords,
      input.participantCount, now).run()
    const row = await scope.db.prepare(`
      SELECT id,title,kind,started_at AS startedAt,ended_at AS endedAt,
        duration_seconds AS durationSeconds,words_credited AS wordsCredited,
        replies_completed AS repliesCompleted,goal_words AS goalWords,
        participant_count AS participantCount
      FROM writing_sprints WHERE workspace_id=? AND id=?
    `).bind(scope.workspaceId, input.id).first<Record<string, unknown>>()
    if (!row) throw new HTTPException(409, { message: 'This sprint could not be saved to this account.' })
    if (!saved.meta.changes && (row.title !== input.title || row.wordsCredited !== input.wordsCredited || row.repliesCompleted !== input.repliesCompleted)) {
      throw new HTTPException(409, { message: 'A different sprint already uses this result ID.' })
    }
    return c.json(row, saved.meta.changes ? 201 : 200)
  })

  return app
}
