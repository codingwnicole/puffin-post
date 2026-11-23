import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { isModerator } from '../auth/moderator'
import type { Env } from '../worker'

const statusSchema = z.enum(['considering','planned','in_progress','complete'])
const editable = z.object({ title:z.string().trim().min(4).max(160).optional(), description:z.string().trim().min(1).max(3000).optional(), status:statusSchema.optional(), move:z.union([z.literal(-1),z.literal(1)]).optional() }).strict()

export function roadmapRoutes() {
  const app = new Hono<{ Bindings:Env }>()
  app.get('/', async c => {
    let canManage=false
    try {
      const scope=await requireWorkspace(c)
      canManage=isModerator(scope.userId,c.env.MODERATOR_USER_ID)
    } catch(error) {
      if(!(error instanceof HTTPException && (error.status===401 || error.status===403))) throw error
    }
    const items=await c.env.DB.prepare(`SELECT id,title,description,status,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt
      FROM site_roadmap_items ORDER BY sort_order,created_at,id`).all()
    return c.json({items:items.results,canManage})
  })
  app.post('/', async c => {
    const scope=await requireWorkspace(c)
    if(!isModerator(scope.userId,c.env.MODERATOR_USER_ID))throw new HTTPException(403,{message:'Only the RP Thread Buddy admin can manage the roadmap'})
    const body=z.object({title:z.string().trim().min(4).max(160),description:z.string().trim().min(1).max(3000),status:statusSchema}).strict().parse(await c.req.json())
    const order=await scope.db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM site_roadmap_items').first<{n:number}>()
    const id=crypto.randomUUID(),now=new Date().toISOString()
    await scope.db.prepare('INSERT INTO site_roadmap_items (id,title,description,status,sort_order,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id,body.title,body.description,body.status,order?.n??10,scope.userId,now,now).run()
    return c.json({id},201)
  })
  app.patch('/:id',async c=>{
    const scope=await requireWorkspace(c)
    if(!isModerator(scope.userId,c.env.MODERATOR_USER_ID))throw new HTTPException(403,{message:'Only the RP Thread Buddy admin can manage the roadmap'})
    const body=editable.parse(await c.req.json()),id=c.req.param('id')
    if(body.title===undefined&&body.description===undefined&&body.status===undefined&&body.move===undefined)throw new HTTPException(400,{message:'Choose a roadmap field to update'})
    const item=await scope.db.prepare('SELECT id,sort_order AS sortOrder FROM site_roadmap_items WHERE id=?').bind(id).first<{id:string;sortOrder:number}>()
    if(!item)throw new HTTPException(404,{message:'Roadmap item not found'})
    if(body.title!==undefined||body.description!==undefined||body.status!==undefined){
      await scope.db.prepare(`UPDATE site_roadmap_items SET title=COALESCE(?,title),description=COALESCE(?,description),status=COALESCE(?,status),updated_at=? WHERE id=?`)
        .bind(body.title??null,body.description??null,body.status??null,new Date().toISOString(),id).run()
    }
    if(body.move!==undefined){
      const ordered=await scope.db.prepare('SELECT id,sort_order AS sortOrder FROM site_roadmap_items ORDER BY sort_order,created_at,id').all<{id:string;sortOrder:number}>()
      const index=ordered.results.findIndex(row=>row.id===id),other=ordered.results[index+body.move]
      if(other){
        const now=new Date().toISOString()
        await scope.db.batch([
          scope.db.prepare('UPDATE site_roadmap_items SET sort_order=?,updated_at=? WHERE id=?').bind(other.sortOrder,now,id),
          scope.db.prepare('UPDATE site_roadmap_items SET sort_order=?,updated_at=? WHERE id=?').bind(item.sortOrder,now,other.id),
        ])
      }
    }
    return c.json({ok:true})
  })
  app.delete('/:id',async c=>{
    const scope=await requireWorkspace(c)
    if(!isModerator(scope.userId,c.env.MODERATOR_USER_ID))throw new HTTPException(403,{message:'Only the RP Thread Buddy admin can manage the roadmap'})
    const result=await scope.db.prepare('DELETE FROM site_roadmap_items WHERE id=?').bind(c.req.param('id')).run()
    if(!result.meta.changes)throw new HTTPException(404,{message:'Roadmap item not found'})
    return c.body(null,204)
  })
  return app
}
