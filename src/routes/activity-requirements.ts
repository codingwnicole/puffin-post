import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { canonicalBlogIdentifier } from '../tumblr/normalize'
import { ownedTumblrBlogs } from '../tumblr/blog-identities'
import { sendWorkspacePush } from './push'
import { calendarDaysAfter } from '../shared/sprint-stats'
import type { Env } from '../worker'

const requirementSchema = z.object({
  id: z.string().optional(), groupId: z.string().min(1), scope: z.enum(['group','character','blog']),
  characterId: z.string().nullable().default(null), blogIdentifier: z.string().trim().max(255).nullable().default(null),
  intervalDays: z.number().int().min(1).max(90), reminderBeforeHours: z.number().int().min(0).max(720).default(24),
  reminderDue: z.boolean().default(true), reminderOverdue: z.boolean().default(true), graceHours: z.number().int().min(0).max(720).default(0),
  enabled: z.boolean().default(true), allowManual: z.boolean().default(false), timezone: z.string().min(1).max(80).default('UTC'),
}).strict().superRefine((value, context) => {
  if (value.scope === 'character' && !value.characterId) context.addIssue({ code: 'custom', path: ['characterId'], message: 'Choose a character for a character-level requirement' })
  if (value.scope !== 'character' && value.characterId) context.addIssue({ code: 'custom', path: ['characterId'], message: 'Character is only used for character-level requirements' })
  if (value.scope === 'blog' && !value.blogIdentifier) context.addIssue({ code: 'custom', path: ['blogIdentifier'], message: 'Choose a blog for a blog-level requirement' })
  if (value.scope !== 'blog' && value.blogIdentifier) context.addIssue({ code: 'custom', path: ['blogIdentifier'], message: 'Blog is only used for blog-level requirements' })
})

type Requirement = { id: string; workspaceId: string; groupId: string; groupName: string; scope: 'group'|'character'|'blog'; characterId: string|null; characterName: string|null; blogIdentifier: string|null; intervalDays: number; reminderBeforeHours: number; reminderDue: number; reminderOverdue: number; graceHours: number; enabled: number; allowManual: number; timezone: string; createdAt: string }

async function metadataForWorkspace(db: D1Database, workspaceId: string) {
  const connections = await db.prepare("SELECT account_metadata_json AS metadata FROM tumblr_connections WHERE workspace_id=? AND status='active'").bind(workspaceId).all<{ metadata: string }>()
  return ownedTumblrBlogs(connections.results.map(row => row.metadata))
}

async function lastOwnActivity(db: D1Database, requirement: Requirement, ownBlogIds: string[]): Promise<{ at: string; source: 'tumblr'|'manual' } | null> {
  let latest: { at: string; source: 'tumblr'|'manual' } | null = null
  if (ownBlogIds.length) {
    const clauses = ['b.workspace_id=?','s.workspace_id=b.workspace_id','s.id=b.starter_id','s.rp_group_id=?','s.archived=0','b.archived_at IS NULL','b.last_activity_at IS NOT NULL',`LOWER(b.last_poster) IN (${ownBlogIds.map(() => '?').join(',')})`]
    const binds: (string|number)[] = [requirement.workspaceId, requirement.groupId, ...ownBlogIds.map(id => id.toLowerCase())]
    if (requirement.scope === 'character') { clauses.push('s.character_id=?'); binds.push(requirement.characterId as string) }
    if (requirement.scope === 'blog') { clauses.push('LOWER(b.last_poster)=?'); binds.push(canonicalBlogIdentifier(requirement.blogIdentifier ?? '').toLowerCase()) }
    const row = await db.prepare(`SELECT MAX(b.last_activity_at) AS at FROM reply_branches b JOIN starters s ON s.workspace_id=b.workspace_id AND s.id=b.starter_id WHERE ${clauses.join(' AND ')}`)
      .bind(...binds).first<{ at: string | null }>()
    if (row?.at) latest = { at: row.at, source: 'tumblr' }
  }
  if (requirement.allowManual) {
    const manual = await db.prepare('SELECT MAX(activity_at) AS at FROM rp_activity_manual_logs WHERE workspace_id=? AND requirement_id=?').bind(requirement.workspaceId, requirement.id).first<{ at: string | null }>()
    if (manual?.at && (!latest || manual.at > latest.at)) latest = { at: manual.at, source: 'manual' }
  }
  return latest
}

function plusHours(value: string, hours: number) { return new Date(Date.parse(value) + hours * 3_600_000).toISOString() }
function validTimezone(value: string) { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false } }
function formatInZone(value: string, timeZone: string) { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

async function getRequirementRows(db: D1Database, workspaceId: string) {
  return db.prepare(`SELECT r.id,r.workspace_id AS workspaceId,r.group_id AS groupId,g.name AS groupName,r.scope,r.character_id AS characterId,c.name AS characterName,
    r.blog_identifier AS blogIdentifier,r.interval_days AS intervalDays,r.reminder_before_hours AS reminderBeforeHours,r.reminder_due AS reminderDue,r.reminder_overdue AS reminderOverdue,
    r.grace_hours AS graceHours,r.enabled,r.allow_manual AS allowManual,r.timezone,r.created_at AS createdAt
    FROM rp_activity_requirements r JOIN rp_groups g ON g.workspace_id=r.workspace_id AND g.id=r.group_id
    LEFT JOIN characters c ON c.workspace_id=r.workspace_id AND c.id=r.character_id WHERE r.workspace_id=? ORDER BY g.name,r.scope,c.name,r.blog_identifier`)
    .bind(workspaceId).all<Requirement>()
}

async function overviewFor(db: D1Database, requirement: Requirement, ownBlogs: string[], now: Date) {
  const latest = await lastOwnActivity(db, requirement, ownBlogs)
  const base = latest?.at ?? requirement.createdAt
  const deadlineAt = calendarDaysAfter(base, requirement.intervalDays, requirement.timezone)
  const remainingMs = Date.parse(deadlineAt) + requirement.graceHours * 3_600_000 - now.getTime()
  return { ...requirement, lastActivityAt: latest?.at ?? null, lastActivitySource: latest?.source ?? null, deadlineAt, remainingMs,
    status: !requirement.enabled ? 'paused' : remainingMs < 0 ? 'overdue' : remainingMs <= 24 * 3_600_000 ? 'due-soon' : 'on-track' }
}

export function activityRequirementRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const [requirements, groups, characters, blogs, owned] = await Promise.all([
      getRequirementRows(scope.db, scope.workspaceId),
      scope.db.prepare('SELECT id,name FROM rp_groups WHERE workspace_id=? ORDER BY name COLLATE NOCASE').bind(scope.workspaceId).all(),
      scope.db.prepare(`SELECT c.id,c.name,rgc.group_id AS groupId FROM characters c JOIN rp_group_characters rgc ON rgc.workspace_id=c.workspace_id AND rgc.character_id=c.id WHERE c.workspace_id=? AND c.state='active' ORDER BY c.name`).bind(scope.workspaceId).all(),
      scope.db.prepare(`SELECT DISTINCT cb.blog_identifier AS blogIdentifier,cb.display_label AS displayLabel,rgc.group_id AS groupId FROM character_blogs cb JOIN rp_group_characters rgc ON rgc.workspace_id=cb.workspace_id AND rgc.character_id=cb.character_id WHERE cb.workspace_id=? ORDER BY cb.display_label`).bind(scope.workspaceId).all(),
      metadataForWorkspace(scope.db, scope.workspaceId),
    ])
    const own = [...owned.identifiers]
    const now = new Date()
    const overview = await Promise.all(requirements.results.map(item => overviewFor(scope.db, item, own, now)))
    return c.json({ groups: groups.results, characters: characters.results, blogs: blogs.results, requirements: overview })
  })

  app.post('/', async c => {
    const scope = await requireWorkspace(c), parsed = requirementSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the activity requirement details' })
    const input = parsed.data
    if (!validTimezone(input.timezone)) throw new HTTPException(400, { message: 'Choose a valid time zone' })
    if (!await scope.db.prepare('SELECT id FROM rp_groups WHERE workspace_id=? AND id=?').bind(scope.workspaceId, input.groupId).first()) throw new HTTPException(404, { message: 'RP section not found' })
    if (input.scope === 'character') {
      const member = await scope.db.prepare('SELECT 1 FROM rp_group_characters WHERE workspace_id=? AND group_id=? AND character_id=?').bind(scope.workspaceId, input.groupId, input.characterId).first()
      if (!member) throw new HTTPException(400, { message: 'Add this character to the RP section first' })
    }
    const blog = input.scope === 'blog' ? canonicalBlogIdentifier(input.blogIdentifier as string) : null
    if (input.scope === 'blog') {
      const member = await scope.db.prepare('SELECT 1 FROM character_blogs cb JOIN rp_group_characters rgc ON rgc.workspace_id=cb.workspace_id AND rgc.character_id=cb.character_id WHERE cb.workspace_id=? AND rgc.group_id=? AND LOWER(cb.blog_identifier)=LOWER(?)').bind(scope.workspaceId, input.groupId, blog).first()
      if (!member) throw new HTTPException(400, { message: 'Choose a connected blog assigned to a character in this RP section' })
    }
    const now = new Date().toISOString()
    const existing = input.id ? await scope.db.prepare('SELECT id FROM rp_activity_requirements WHERE workspace_id=? AND id=? AND group_id=?').bind(scope.workspaceId, input.id, input.groupId).first<{id:string}>()
      : await scope.db.prepare(`SELECT id FROM rp_activity_requirements WHERE workspace_id=? AND group_id=? AND scope=? AND COALESCE(character_id,'')=COALESCE(?,'') AND COALESCE(blog_identifier,'')=COALESCE(?,'')`).bind(scope.workspaceId, input.groupId, input.scope, input.characterId, blog).first<{id:string}>()
    const id = existing?.id ?? crypto.randomUUID()
    const values = [input.scope, input.characterId, blog, input.intervalDays, input.reminderBeforeHours, input.reminderDue ? 1 : 0, input.reminderOverdue ? 1 : 0, input.graceHours, input.enabled ? 1 : 0, input.allowManual ? 1 : 0, input.timezone]
    if (existing) await scope.db.prepare(`UPDATE rp_activity_requirements SET scope=?,character_id=?,blog_identifier=?,interval_days=?,reminder_before_hours=?,reminder_due=?,reminder_overdue=?,grace_hours=?,enabled=?,allow_manual=?,timezone=?,updated_at=? WHERE workspace_id=? AND id=?`)
      .bind(...values, now, scope.workspaceId, id).run()
    else await scope.db.prepare(`INSERT INTO rp_activity_requirements (id,workspace_id,group_id,scope,character_id,blog_identifier,interval_days,reminder_before_hours,reminder_due,reminder_overdue,grace_hours,enabled,allow_manual,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, scope.workspaceId, input.groupId, ...values, now, now).run()
    return c.json({ id }, existing ? 200 : 201)
  })

  app.post('/:id/manual', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('id')
    const req = await scope.db.prepare('SELECT id,allow_manual AS allowManual FROM rp_activity_requirements WHERE workspace_id=? AND id=?').bind(scope.workspaceId, id).first<{id:string;allowManual:number}>()
    if (!req) throw new HTTPException(404, { message: 'Activity requirement not found' })
    if (!req.allowManual) throw new HTTPException(403, { message: 'Manual activity logging is turned off for this requirement' })
    const parsed = z.object({ activityAt: z.string().datetime({ offset: true }), note: z.string().trim().max(300).default('') }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Provide a valid activity date' })
    if (Date.parse(parsed.data.activityAt) > Date.now() + 5 * 60_000) throw new HTTPException(400, { message: 'Activity cannot be in the future' })
    await scope.db.prepare('INSERT INTO rp_activity_manual_logs (id,workspace_id,requirement_id,activity_at,note,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), scope.workspaceId, id, new Date(parsed.data.activityAt).toISOString(), parsed.data.note, scope.userId, new Date().toISOString()).run()
    return c.body(null, 201)
  })

  app.delete('/:id', async c => {
    const scope = await requireWorkspace(c), result = await scope.db.prepare('DELETE FROM rp_activity_requirements WHERE workspace_id=? AND id=?').bind(scope.workspaceId, c.req.param('id')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Activity requirement not found' })
    return c.body(null, 204)
  })
  return app
}

/** Scheduled every half hour. A unique (requirement, deadline, kind) row is
 * claimed before push; failed delivery releases the claim for a later retry. */
export async function sendActivityRequirementReminders(env: Env, now = new Date()) {
  if (!env.PUSH_VAPID_PRIVATE_KEY) return
  const all = await env.DB.prepare(`SELECT r.id,r.workspace_id AS workspaceId,r.group_id AS groupId,g.name AS groupName,r.scope,r.character_id AS characterId,c.name AS characterName,
    r.blog_identifier AS blogIdentifier,r.interval_days AS intervalDays,r.reminder_before_hours AS reminderBeforeHours,r.reminder_due AS reminderDue,r.reminder_overdue AS reminderOverdue,
    r.grace_hours AS graceHours,r.enabled,r.allow_manual AS allowManual,r.timezone,r.created_at AS createdAt
    FROM rp_activity_requirements r JOIN rp_groups g ON g.workspace_id=r.workspace_id AND g.id=r.group_id LEFT JOIN characters c ON c.workspace_id=r.workspace_id AND c.id=r.character_id
    WHERE r.enabled=1 ORDER BY r.updated_at LIMIT 200`).all<Requirement>()
  for (const requirement of all.results) {
    const owned = await metadataForWorkspace(env.DB, requirement.workspaceId)
    const latest = await lastOwnActivity(env.DB, requirement, [...owned.identifiers])
    const deadlineAt = calendarDaysAfter(latest?.at ?? requirement.createdAt, requirement.intervalDays, requirement.timezone)
    const at = Date.parse(deadlineAt), current = now.getTime(), graceDeadline = at + requirement.graceHours * 3_600_000
    let kind: 'upcoming'|'due'|'overdue'|null = null
    if (current < at && current >= at - requirement.reminderBeforeHours * 3_600_000 && requirement.reminderBeforeHours > 0) kind = 'upcoming'
    // The scheduler runs every 30 minutes, so a zero-grace deadline will
    // almost never equal `current`. Keep the due reminder eligible for a full
    // scheduler interval before classifying it as overdue.
    else if (current >= at && current < at + Math.max(requirement.graceHours * 3_600_000, 30 * 60_000) && requirement.reminderDue) kind = 'due'
    else if (current > graceDeadline && requirement.reminderOverdue) kind = 'overdue'
    if (!kind) continue
    const claim = await env.DB.prepare(`INSERT INTO rp_activity_requirement_deliveries (workspace_id,requirement_id,deadline_at,reminder_kind,delivered_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`)
      .bind(requirement.workspaceId, requirement.id, deadlineAt, kind, now.toISOString()).run()
    if (!claim.meta.changes) continue
    const scopeLabel = requirement.scope === 'character' ? requirement.characterName ?? 'a character' : requirement.scope === 'blog' ? 'a Tumblr blog' : requirement.groupName
    const body = kind === 'upcoming' ? `Your ${requirement.intervalDays}-day activity window is coming up for ${scopeLabel}.` : kind === 'due' ? `Your activity window is due for ${scopeLabel}.` : `Your activity window is overdue for ${scopeLabel}.`
    const sent = await sendWorkspacePush(env, requirement.workspaceId, { title: 'RP activity check-in', body, url: '/#settings' }, 'activity_requirements')
    if (!sent) await env.DB.prepare('DELETE FROM rp_activity_requirement_deliveries WHERE workspace_id=? AND requirement_id=? AND deadline_at=? AND reminder_kind=?').bind(requirement.workspaceId, requirement.id, deadlineAt, kind).run()
  }
}
