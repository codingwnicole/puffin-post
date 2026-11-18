import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import type { Env } from '../worker'

const statusSchema = z.enum(['reported', 'acknowledged', 'investigating', 'planned', 'fixed'])
const moderatorEmail = 'tmixwix@gmail.com'

async function emailWorkspaceOwner(env: Env, db: D1Database, workspaceId: string, from: string, kind: string, title: string, description: string) {
  const owner = await db.prepare(`SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=? AND m.role='owner' ORDER BY m.created_at LIMIT 1`).bind(workspaceId).first<{ email: string }>()
  const recipient = env.BOOTSTRAP_OWNER_EMAIL ?? owner?.email
  if (!recipient) return
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [recipient], subject: `New Puffin Post ${kind} report: ${title}`, text: `From: ${from}\n\n${description}` }),
  })
  if (!response.ok) throw new Error('Unable to email the report')
}

export function supportRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  const canModerate = (email:string) => email.toLowerCase() === moderatorEmail
  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    const items = await scope.db.prepare(`SELECT si.id,si.kind,si.title,si.description,si.status,si.created_at AS createdAt,si.updated_at AS updatedAt,
      count(sv.user_id) AS voteCount, max(CASE WHEN sv.user_id=? THEN 1 ELSE 0 END) AS voted
      FROM support_items si LEFT JOIN support_votes sv ON sv.support_item_id=si.id
      GROUP BY si.id ORDER BY CASE si.status WHEN 'investigating' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'planned' THEN 2 WHEN 'reported' THEN 3 ELSE 4 END, voteCount DESC, si.updated_at DESC`).bind(scope.userId).all()
    // The board is shared by every user: never send emails (only the admin can comment).
    const comments=await scope.db.prepare(`SELECT sc.id,sc.support_item_id AS supportItemId,sc.body,sc.created_at AS createdAt
      FROM support_comments sc ORDER BY sc.created_at`).all<{id:string;supportItemId:string;body:string;createdAt:string}>()
    return c.json({ items: items.results.map(item=>({...item,comments:comments.results.filter(comment=>comment.supportItemId===item.id)})), canManage: canModerate(scope.email) })
  })
  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ kind: z.enum(['bug', 'feature']), title: z.string().trim().min(4).max(160), description: z.string().trim().min(8).max(5000) }).strict().parse(await c.req.json())
    const id = crypto.randomUUID(), now = new Date().toISOString()
    await scope.db.prepare('INSERT INTO support_items (id,kind,title,description,submitted_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, body.kind, body.title, body.description, scope.userId, now, now).run()
    await emailWorkspaceOwner(c.env, scope.db, scope.workspaceId, scope.email, body.kind, body.title, body.description)
    return c.json({ id }, 201)
  })
  app.post('/:id/vote', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('id')
    if (!await scope.db.prepare('SELECT id FROM support_items WHERE id=?').bind(id).first()) throw new HTTPException(404, { message: 'Support item not found' })
    const existing = await scope.db.prepare('SELECT 1 FROM support_votes WHERE support_item_id=? AND user_id=?').bind(id, scope.userId).first()
    if (existing) await scope.db.prepare('DELETE FROM support_votes WHERE support_item_id=? AND user_id=?').bind(id, scope.userId).run()
    else await scope.db.prepare('INSERT INTO support_votes (support_item_id,user_id,created_at) VALUES (?,?,?)').bind(id, scope.userId, new Date().toISOString()).run()
    return c.json({ voted: !existing })
  })
  app.patch('/:id', async c => {
    const scope = await requireWorkspace(c)
    if (!canModerate(scope.email)) throw new HTTPException(403, { message: 'Only the Puffin Post admin can update support status' })
    const body = z.object({ status: statusSchema }).strict().parse(await c.req.json())
    const result = await scope.db.prepare('UPDATE support_items SET status=?,updated_at=? WHERE id=?').bind(body.status, new Date().toISOString(), c.req.param('id')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Support item not found' })
    return c.json({ ok: true })
  })
  app.post('/:id/comments',async c=>{
    const scope=await requireWorkspace(c), id=c.req.param('id')
    if(!canModerate(scope.email))throw new HTTPException(403,{message:'Only the Puffin Post admin can reply'})
    const body=z.object({body:z.string().trim().min(1).max(5000)}).parse(await c.req.json())
    if(!await scope.db.prepare('SELECT id FROM support_items WHERE id=?').bind(id).first())throw new HTTPException(404,{message:'Support item not found'})
    const comment={id:crypto.randomUUID(),supportItemId:id,body:body.body,createdAt:new Date().toISOString()}
    await scope.db.prepare('INSERT INTO support_comments (id,support_item_id,user_id,body,created_at) VALUES (?,?,?,?,?)').bind(comment.id,id,scope.userId,comment.body,comment.createdAt).run()
    return c.json(comment,201)
  })
  app.delete('/:id',async c=>{
    const scope=await requireWorkspace(c)
    if(!canModerate(scope.email))throw new HTTPException(403,{message:'Only the Puffin Post admin can delete support items'})
    const result=await scope.db.prepare('DELETE FROM support_items WHERE id=?').bind(c.req.param('id')).run()
    if(!result.meta.changes)throw new HTTPException(404,{message:'Support item not found'})
    return c.body(null,204)
  })
  return app
}
