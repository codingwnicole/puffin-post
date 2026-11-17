import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { iconContentTypeAllowed, validatedRasterType } from '../storage/icons'

type PlanInput = { name?: string; faceclaim?: string | null; notes?: string | null; state?: 'idea' | 'developing' | 'ready' }

function cleanPlan(input: PlanInput, requireName = false) {
  const name = input.name?.trim()
  if (requireName && !name) throw new HTTPException(400, { message: 'Give this character idea a name or working title' })
  if (input.state && !['idea', 'developing', 'ready'].includes(input.state)) throw new HTTPException(400, { message: 'Choose a valid planning stage' })
  return { name: name?.slice(0, 200), faceclaim: input.faceclaim?.trim().slice(0, 200) || null, notes: input.notes?.trim().slice(0, 20000) ?? '', state: input.state }
}

async function requirePlan(c: Context<{ Bindings: Env }>, id: string) {
  const s = await requireWorkspace(c)
  const plan = await s.db.prepare('SELECT id FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId, id).first()
  if (!plan) throw new HTTPException(404, { message: 'Character plan not found' })
  return s
}

export function characterPlannerRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/', async c => {
    const s = await requireWorkspace(c)
    const plans = await s.db.prepare('SELECT id,name,faceclaim,notes,state,icon_object_key AS iconObjectKey,created_at AS createdAt,updated_at AS updatedAt FROM character_plans WHERE workspace_id=? ORDER BY updated_at DESC, name').bind(s.workspaceId).all()
    const resources = await s.db.prepare('SELECT id,plan_id AS planId,label,url FROM character_plan_resources WHERE workspace_id=? ORDER BY created_at').bind(s.workspaceId).all()
    return c.json(plans.results.map(plan => ({ ...plan, resources: resources.results.filter(resource => resource.planId === plan.id) })))
  })

  app.post('/', async c => {
    const s = await requireWorkspace(c), input = cleanPlan(await c.req.json<PlanInput>(), true), id = crypto.randomUUID()
    await s.db.prepare('INSERT INTO character_plans (id,workspace_id,name,faceclaim,notes,state) VALUES (?,?,?,?,?,?)').bind(id, s.workspaceId, input.name, input.faceclaim, input.notes, input.state ?? 'idea').run()
    return c.json({ id }, 201)
  })

  app.patch('/:id', async c => {
    const s = await requirePlan(c, c.req.param('id')), input = cleanPlan(await c.req.json<PlanInput>())
    const result = await s.db.prepare('UPDATE character_plans SET name=COALESCE(?,name),faceclaim=?,notes=?,state=COALESCE(?,state),updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?').bind(input.name ?? null, input.faceclaim, input.notes, input.state ?? null, s.workspaceId, c.req.param('id')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Character plan not found' })
    return c.body(null, 204)
  })

  app.post('/:id/add-to-cast', async c => {
    const s = await requirePlan(c, c.req.param('id'))
    const plan = await s.db.prepare('SELECT name,notes,icon_object_key AS iconObjectKey,source_character_id AS sourceCharacterId FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')).first<{name:string;notes:string;iconObjectKey:string|null;sourceCharacterId:string|null}>()
    if (!plan) throw new HTTPException(404,{message:'Character plan not found'})
    const resources = await s.db.prepare('SELECT label,url FROM character_plan_resources WHERE workspace_id=? AND plan_id=?').bind(s.workspaceId,c.req.param('id')).all<{label:string;url:string}>()
    let characterId: string
    const batch: ReturnType<typeof s.db.prepare>[] = []
    if (plan.sourceCharacterId) {
      characterId = plan.sourceCharacterId
      batch.push(s.db.prepare('UPDATE characters SET name=?,icon_object_key=COALESCE(?,icon_object_key),state=\'active\',notes=? WHERE workspace_id=? AND id=?').bind(plan.name,plan.iconObjectKey,plan.notes,s.workspaceId,plan.sourceCharacterId))
      for (const resource of resources.results) {
        const existing = await s.db.prepare('SELECT id FROM character_quicklinks WHERE workspace_id=? AND character_id=? AND url=?').bind(s.workspaceId,characterId,resource.url).first()
        if (!existing) batch.push(s.db.prepare('INSERT INTO character_quicklinks (id,workspace_id,character_id,label,url) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),s.workspaceId,characterId,resource.label,resource.url))
      }
    } else {
      characterId = crypto.randomUUID()
      batch.push(s.db.prepare('INSERT INTO characters (id,workspace_id,name,icon_object_key,state,notes) VALUES (?,?,?,?,?,?)').bind(characterId,s.workspaceId,plan.name,plan.iconObjectKey,'active',plan.notes))
      for (const resource of resources.results) {
        batch.push(s.db.prepare('INSERT INTO character_quicklinks (id,workspace_id,character_id,label,url) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),s.workspaceId,characterId,resource.label,resource.url))
      }
    }
    batch.push(s.db.prepare('DELETE FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')))
    await s.db.batch(batch)
    return c.json({id:characterId,name:plan.name},201)
  })

  // Reverse of the character route's return-to-planner: undo a "moved to planner".
  // Re-activate the (hiatus) character and delete the plan it was turned into.
  app.post('/return-to-cast/:characterId', async c => {
    const s = await requireWorkspace(c), id = c.req.param('characterId')
    const plan = await s.db.prepare('SELECT id,name FROM character_plans WHERE workspace_id=? AND source_character_id=?').bind(s.workspaceId, id).first<{id:string;name:string}>()
    if (!plan) throw new HTTPException(404, { message: 'No planner idea for this character' })
    await s.db.batch([
      s.db.prepare("UPDATE characters SET state='active' WHERE workspace_id=? AND id=? AND state='hiatus'").bind(s.workspaceId, id),
      s.db.prepare('DELETE FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId, plan.id),
    ])
    return c.json({ id, name: plan.name }, 200)
  })

  app.delete('/:id', async c => {
    const s = await requirePlan(c, c.req.param('id'))
    const plan=await s.db.prepare('SELECT icon_object_key AS iconObjectKey,source_character_id AS sourceCharacterId FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')).first<{iconObjectKey:string|null;sourceCharacterId:string|null}>()
    // A plan returned from the cast still owns a hidden (hiatus) character. Deleting the idea must not
    // strand it as an invisible ghost: move it to Archived, where it stays visible and restorable.
    await s.db.batch([
      ...(plan?.sourceCharacterId ? [s.db.prepare("UPDATE characters SET state='archived' WHERE workspace_id=? AND id=? AND state='hiatus'").bind(s.workspaceId,plan.sourceCharacterId)] : []),
      s.db.prepare('DELETE FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId, c.req.param('id')),
    ])
    if(plan?.iconObjectKey)c.executionCtx.waitUntil(c.env.ICONS.delete(plan.iconObjectKey))
    return c.body(null, 204)
  })

  app.post('/:id/icon', async c => {
    const s=await requirePlan(c,c.req.param('id')),form=await c.req.formData(),file=form.get('icon')
    if(!(file instanceof File)||!iconContentTypeAllowed(file.type)||!file.size||file.size>2*1024*1024)throw new HTTPException(400,{message:'Choose a JPG, PNG, or WebP image under 2 MB'})
    const contentType=await validatedRasterType(file),previous=await s.db.prepare('SELECT icon_object_key AS iconObjectKey FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')).first<{iconObjectKey:string|null}>(),key=`character-plans/${s.workspaceId}/${c.req.param('id')}/${crypto.randomUUID()}`
    await c.env.ICONS.put(key,file.stream(),{httpMetadata:{contentType}})
    try{await s.db.prepare('UPDATE character_plans SET icon_object_key=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?').bind(key,s.workspaceId,c.req.param('id')).run()}catch(error){await c.env.ICONS.delete(key);throw error}
    if(previous?.iconObjectKey)c.executionCtx.waitUntil(c.env.ICONS.delete(previous.iconObjectKey))
    return c.json({url:'/api/character-planner/'+c.req.param('id')+'/icon'},201)
  })

  app.get('/:id/icon', async c => {
    const s=await requirePlan(c,c.req.param('id')),plan=await s.db.prepare('SELECT icon_object_key AS iconObjectKey FROM character_plans WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')).first<{iconObjectKey:string|null}>()
    if(!plan?.iconObjectKey)throw new HTTPException(404,{message:'Planner image not found'})
    const object=await c.env.ICONS.get(plan.iconObjectKey);if(!object)throw new HTTPException(404,{message:'Planner image not found'})
    return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType??'application/octet-stream','cache-control':'private, max-age=300','x-content-type-options':'nosniff'}})
  })

  app.post('/:id/resources', async c => {
    const s = await requirePlan(c, c.req.param('id')), body = await c.req.json<{ label?: string; url?: string }>(), label = body.label?.trim()
    if (!label || !body.url) throw new HTTPException(400, { message: 'Resource label and URL are required' })
    let url: URL
    try { url = new URL(body.url) } catch { throw new HTTPException(400, { message: 'Use a valid link URL' }) }
    if (!['https:', 'http:'].includes(url.protocol)) throw new HTTPException(400, { message: 'Use a valid link URL' })
    const id = crypto.randomUUID()
    await s.db.batch([
      s.db.prepare('INSERT INTO character_plan_resources (id,workspace_id,plan_id,label,url) VALUES (?,?,?,?,?)').bind(id, s.workspaceId, c.req.param('id'), label.slice(0, 120), url.toString()),
      s.db.prepare('UPDATE character_plans SET updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?').bind(s.workspaceId, c.req.param('id')),
    ])
    return c.json({ id, label: label.slice(0, 120), url: url.toString() }, 201)
  })

  app.delete('/:id/resources/:resourceId', async c => {
    const s = await requirePlan(c, c.req.param('id'))
    const result = await s.db.prepare('DELETE FROM character_plan_resources WHERE workspace_id=? AND plan_id=? AND id=?').bind(s.workspaceId, c.req.param('id'), c.req.param('resourceId')).run()
    if (!result.meta.changes) throw new HTTPException(404, { message: 'Planner resource not found' })
    await s.db.prepare('UPDATE character_plans SET updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?').bind(s.workspaceId, c.req.param('id')).run()
    return c.body(null, 204)
  })

  return app
}
