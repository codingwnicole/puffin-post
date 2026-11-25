import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'

const prefsSchema = z.object({
  inAppEnabled: z.boolean(), pushEnabled: z.boolean(), globalMuted: z.boolean(),
  notifyReplies: z.boolean(), notifyReminders: z.boolean(), notifyPossibleThreads: z.boolean(),
  notifyActivityRequirements: z.boolean(), timezone: z.string().min(1).max(80),
  quietStartLocal: z.number().int().min(0).max(23).nullable(), quietEndLocal: z.number().int().min(0).max(23).nullable(),
}).strict().superRefine((value, context) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format() }
  catch { context.addIssue({ code: 'custom', path: ['timezone'], message: 'Choose a valid time zone' }) }
  if ((value.quietStartLocal === null) !== (value.quietEndLocal === null)) context.addIssue({ code: 'custom', path: ['quietEndLocal'], message: 'Set both quiet-hour times or clear both' })
})

const DEFAULTS = { inAppEnabled: true, pushEnabled: false, globalMuted: false, notifyReplies: true, notifyReminders: true, notifyPossibleThreads: true, notifyActivityRequirements: true, timezone: 'UTC', quietStartLocal: null as number | null, quietEndLocal: null as number | null }

export function notificationPreferenceRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const [row, subscriptions] = await Promise.all([
      scope.db.prepare(`SELECT in_app_enabled AS inAppEnabled,global_muted AS globalMuted,notify_replies AS notifyReplies,notify_reminders AS notifyReminders,
        notify_activity AS notifyPossibleThreads,notify_activity_requirements AS notifyActivityRequirements,timezone,quiet_start_local AS quietStartLocal,quiet_end_local AS quietEndLocal
        FROM notification_preferences WHERE workspace_id=? AND user_id=?`).bind(scope.workspaceId, scope.userId).first<Record<string, unknown>>(),
      scope.db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE workspace_id=? AND user_id=?').bind(scope.workspaceId, scope.userId).first<{count:number}>(),
    ])
    const value = row ? {
      inAppEnabled: Boolean(row.inAppEnabled), globalMuted: Boolean(row.globalMuted), notifyReplies: Boolean(row.notifyReplies),
      notifyReminders: Boolean(row.notifyReminders), notifyPossibleThreads: Boolean(row.notifyPossibleThreads),
      notifyActivityRequirements: Boolean(row.notifyActivityRequirements), timezone: String(row.timezone || 'UTC'),
      quietStartLocal: row.quietStartLocal === null ? null : Number(row.quietStartLocal), quietEndLocal: row.quietEndLocal === null ? null : Number(row.quietEndLocal),
    } : { ...DEFAULTS }
    return c.json({ ...value, pushEnabled: (subscriptions?.count ?? 0) > 0, pushDevices: subscriptions?.count ?? 0, emailAvailable: false })
  })
  app.put('/', async c => {
    const scope = await requireWorkspace(c), parsed = prefsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the notification preferences' })
    const input = parsed.data
    if (input.pushEnabled) {
      const hasSubscription = await scope.db.prepare('SELECT id FROM push_subscriptions WHERE workspace_id=? AND user_id=? LIMIT 1').bind(scope.workspaceId, scope.userId).first()
      if (!hasSubscription) throw new HTTPException(409, { message: 'Turn on browser notifications for this device before enabling push alerts' })
    }
    await scope.db.prepare(`INSERT INTO notification_preferences (workspace_id,user_id,notify_replies,notify_reminders,global_muted,in_app_enabled,notify_activity,notify_activity_requirements,timezone,quiet_start_local,quiet_end_local)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET notify_replies=excluded.notify_replies,notify_reminders=excluded.notify_reminders,
      global_muted=excluded.global_muted,in_app_enabled=excluded.in_app_enabled,notify_activity=excluded.notify_activity,notify_activity_requirements=excluded.notify_activity_requirements,
      timezone=excluded.timezone,quiet_start_local=excluded.quiet_start_local,quiet_end_local=excluded.quiet_end_local`)
      .bind(scope.workspaceId, scope.userId, input.notifyReplies ? 1 : 0, input.notifyReminders ? 1 : 0, input.globalMuted ? 1 : 0, input.inAppEnabled ? 1 : 0,
        input.notifyPossibleThreads ? 1 : 0, input.notifyActivityRequirements ? 1 : 0, input.timezone, input.quietStartLocal, input.quietEndLocal).run()
    return c.json(input)
  })
  return app
}
