import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { generateSlug } from '../shared/slugs'
import { characterProfileSchema } from '../shared/character-profile'
import type { Env } from '../worker'

function publicHttpsUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new HTTPException(400, { message: 'Enter a valid HTTPS quiz link' }) }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') ||
    /^(?:0|10|127)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)
  if (url.protocol !== 'https:' || url.username || url.password || privateHost || !host.includes('.')) {
    throw new HTTPException(400, { message: 'Quiz links must use a public HTTPS website' })
  }
  url.hash = ''
  url.hostname = host
  if (url.pathname === '/') url.pathname = ''
  return url.toString().replace(/\/$/u, '')
}

const sourceSchema = z.object({
  title: z.string().trim().min(1).max(120), sourceUrl: z.string().trim().min(1).max(2048),
  category: z.string().trim().max(80).default(''), description: z.string().trim().max(1000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
}).strict()
const resultSchema = z.object({
  quizSourceId: z.string().max(80).nullable().default(null), resultTitle: z.string().trim().min(1).max(160),
  resultText: z.string().trim().max(5000).default(''), notes: z.string().trim().max(3000).default(''),
  completedAt: z.string().datetime({ offset: true }), visibility: z.enum(['private', 'public']).default('private'),
}).strict()

export function characterProfileRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  async function requireCharacter(scope: Awaited<ReturnType<typeof requireWorkspace>>, id: string) {
    const character = await scope.db.prepare('SELECT id,name,notes,icon_object_key AS iconObjectKey,card_json AS cardJson,profile_draft_json AS profileDraftJson FROM characters WHERE workspace_id=? AND id=?')
      .bind(scope.workspaceId, id).first<{ id: string; name: string; notes: string | null; iconObjectKey: string | null; cardJson: string | null; profileDraftJson: string }>()
    if (!character) throw new HTTPException(404, { message: 'Character not found' })
    return character
  }

  app.get('/sources', async c => {
    const scope = await requireWorkspace(c)
    const rows = await scope.db.prepare(`SELECT id,title,source_url AS sourceUrl,category,description,tags_json AS tagsJson,created_at AS createdAt,updated_at AS updatedAt
      FROM character_quiz_sources WHERE workspace_id=? ORDER BY title COLLATE NOCASE`).bind(scope.workspaceId).all<{ tagsJson: string }>()
    return c.json(rows.results.map(row => ({ ...row, tags: JSON.parse(row.tagsJson) as string[], tagsJson: undefined })))
  })

  app.post('/sources', async c => {
    const scope = await requireWorkspace(c)
    const parsed = sourceSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the quiz source details' })
    const input = parsed.data, sourceUrl = publicHttpsUrl(input.sourceUrl), now = new Date().toISOString()
    const existing = await scope.db.prepare(`SELECT id,title,source_url AS sourceUrl,category,description,tags_json AS tagsJson,created_at AS createdAt,updated_at AS updatedAt
      FROM character_quiz_sources WHERE workspace_id=? AND source_url=?`).bind(scope.workspaceId, sourceUrl).first<{ id: string; tagsJson: string }>()
    if (existing) return c.json({ ...existing, tags: JSON.parse(existing.tagsJson) as string[], reused: true })
    const id = crypto.randomUUID()
    await scope.db.prepare(`INSERT INTO character_quiz_sources (id,workspace_id,title,source_url,category,description,tags_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, scope.workspaceId, input.title, sourceUrl, input.category, input.description, JSON.stringify([...new Set(input.tags)]), now, now).run()
    return c.json({ id, ...input, sourceUrl, createdAt: now, updatedAt: now, reused: false }, 201)
  })

  app.delete('/sources/:sourceId', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('sourceId')
    const source = await scope.db.prepare('SELECT id FROM character_quiz_sources WHERE workspace_id=? AND id=?').bind(scope.workspaceId, id).first()
    if (!source) throw new HTTPException(404, { message: 'Quiz source not found' })
    await scope.db.batch([
      scope.db.prepare('UPDATE character_quiz_results SET quiz_source_id=NULL,updated_at=? WHERE workspace_id=? AND quiz_source_id=?').bind(new Date().toISOString(), scope.workspaceId, id),
      scope.db.prepare('DELETE FROM character_quiz_sources WHERE workspace_id=? AND id=?').bind(scope.workspaceId, id),
    ])
    return c.body(null, 204)
  })

  app.get('/:characterId', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('characterId'), character = await requireCharacter(scope, id)
    const [share, sources, results, quicklinks] = await Promise.all([
      scope.db.prepare('SELECT slug,public_profile_published_at AS publishedAt FROM character_shares WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId, id).first<{ slug: string; publishedAt: string | null }>(),
      scope.db.prepare(`SELECT id,title,source_url AS sourceUrl,category,description,tags_json AS tagsJson FROM character_quiz_sources WHERE workspace_id=? ORDER BY title COLLATE NOCASE`).bind(scope.workspaceId).all<{ tagsJson: string }>(),
      scope.db.prepare(`SELECT r.id,r.quiz_source_id AS quizSourceId,r.result_title AS resultTitle,r.result_text AS resultText,r.notes,r.completed_at AS completedAt,r.visibility,q.title AS quizTitle,q.source_url AS sourceUrl
        FROM character_quiz_results r LEFT JOIN character_quiz_sources q ON q.workspace_id=r.workspace_id AND q.id=r.quiz_source_id
        WHERE r.workspace_id=? AND r.character_id=? ORDER BY r.completed_at DESC`).bind(scope.workspaceId, id).all(),
      scope.db.prepare('SELECT id,label,url FROM character_quicklinks WHERE workspace_id=? AND character_id=? ORDER BY created_at').bind(scope.workspaceId, id).all(),
    ])
    return c.json({ character: { id, name: character.name, notes: character.notes ?? '', iconObjectKey: character.iconObjectKey, card: character.cardJson ? JSON.parse(character.cardJson) : null },
      draft: JSON.parse(character.profileDraftJson), share: share ? { slug: share.slug, url: `${c.env.APP_ORIGIN}/c/${share.slug}`, publishedAt: share.publishedAt } : null,
      quizSources: sources.results.map(row => ({ ...row, tags: JSON.parse(row.tagsJson) as string[], tagsJson: undefined })), quizResults: results.results, quicklinks: quicklinks.results })
  })

  app.put('/:characterId/draft', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('characterId')
    await requireCharacter(scope, id)
    const parsed = characterProfileSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the public profile sections' })
    await scope.db.prepare('UPDATE characters SET profile_draft_json=? WHERE workspace_id=? AND id=?').bind(JSON.stringify(parsed.data), scope.workspaceId, id).run()
    return c.json(parsed.data)
  })

  app.post('/:characterId/publish', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('characterId'), character = await requireCharacter(scope, id)
    let parsed: ReturnType<typeof characterProfileSchema.parse>
    try { parsed = characterProfileSchema.parse(JSON.parse(character.profileDraftJson)) }
    catch { throw new HTTPException(409, { message: 'Save a valid public profile draft before publishing' }) }
    const now = new Date().toISOString()
    const existing = await scope.db.prepare('SELECT id,slug FROM character_shares WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId, id).first<{ id: string; slug: string }>()
    if (existing) {
      await scope.db.prepare('UPDATE character_shares SET public_profile_json=?,public_profile_published_at=?,updated_at=? WHERE workspace_id=? AND id=?')
        .bind(JSON.stringify(parsed), now, now, scope.workspaceId, existing.id).run()
      return c.json({ url: `${c.env.APP_ORIGIN}/c/${existing.slug}`, publishedAt: now })
    }
    const slug = generateSlug(), shareId = crypto.randomUUID()
    await scope.db.prepare(`INSERT INTO character_shares (id,workspace_id,character_id,slug,style,show_moodboard,show_playlist,show_stats,indexable,public_profile_json,public_profile_published_at,created_at,updated_at)
      VALUES (?,?,?,?,'card',0,0,0,0,?,?,?,?)`).bind(shareId, scope.workspaceId, id, slug, JSON.stringify(parsed), now, now, now).run()
    return c.json({ url: `${c.env.APP_ORIGIN}/c/${slug}`, publishedAt: now }, 201)
  })

  app.post('/:characterId/unpublish', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('characterId')
    await requireCharacter(scope, id)
    await scope.db.prepare("UPDATE character_shares SET public_profile_json='{}',public_profile_published_at=NULL,updated_at=? WHERE workspace_id=? AND character_id=?")
      .bind(new Date().toISOString(), scope.workspaceId, id).run()
    return c.body(null, 204)
  })

  app.post('/:characterId/quizzes', async c => {
    const scope = await requireWorkspace(c), characterId = c.req.param('characterId')
    await requireCharacter(scope, characterId)
    const parsed = resultSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the quiz result details' })
    const input = parsed.data
    if (input.quizSourceId && !await scope.db.prepare('SELECT id FROM character_quiz_sources WHERE workspace_id=? AND id=?').bind(scope.workspaceId, input.quizSourceId).first()) throw new HTTPException(404, { message: 'Quiz source not found' })
    const id = crypto.randomUUID(), now = new Date().toISOString()
    await scope.db.prepare(`INSERT INTO character_quiz_results (id,workspace_id,character_id,quiz_source_id,result_title,result_text,notes,completed_at,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, scope.workspaceId, characterId, input.quizSourceId, input.resultTitle, input.resultText, input.notes, input.completedAt, input.visibility, now, now).run()
    return c.json({ id, ...input, createdAt: now, updatedAt: now }, 201)
  })

  app.put('/:characterId/quizzes/:resultId', async c => {
    const scope = await requireWorkspace(c), characterId = c.req.param('characterId'), resultId = c.req.param('resultId')
    await requireCharacter(scope, characterId)
    const parsed = resultSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new HTTPException(400, { message: 'Check the quiz result details' })
    const input = parsed.data
    if (input.quizSourceId && !await scope.db.prepare('SELECT id FROM character_quiz_sources WHERE workspace_id=? AND id=?').bind(scope.workspaceId, input.quizSourceId).first()) throw new HTTPException(404, { message: 'Quiz source not found' })
    const row = await scope.db.prepare(`UPDATE character_quiz_results SET quiz_source_id=?,result_title=?,result_text=?,notes=?,completed_at=?,visibility=?,updated_at=?
      WHERE workspace_id=? AND character_id=? AND id=? RETURNING id`).bind(input.quizSourceId, input.resultTitle, input.resultText, input.notes, input.completedAt, input.visibility, new Date().toISOString(), scope.workspaceId, characterId, resultId).first()
    if (!row) throw new HTTPException(404, { message: 'Quiz result not found' })
    return c.json({ id: resultId, ...input })
  })

  app.delete('/:characterId/quizzes/:resultId', async c => {
    const scope = await requireWorkspace(c), characterId = c.req.param('characterId')
    await requireCharacter(scope, characterId)
    const result = await scope.db.prepare('DELETE FROM character_quiz_results WHERE workspace_id=? AND character_id=? AND id=?').bind(scope.workspaceId, characterId, c.req.param('resultId')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Quiz result not found' })
    return c.body(null, 204)
  })

  return app
}
