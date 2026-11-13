import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'

export function titleStyleRoutes(){
  const app=new Hono<{Bindings:Env}>()
  app.get('/',async c=>{const s=await requireWorkspace(c);return c.json((await s.db.prepare('SELECT id,title,description FROM starter_templates WHERE workspace_id=? ORDER BY created_at DESC').bind(s.workspaceId).all()).results)})
  app.post('/',async c=>{const s=await requireWorkspace(c),body=await c.req.json<{name?:string;template?:string}>(),name=body.name?.trim(),template=body.template?.trim();if(!name||!template)throw new HTTPException(400,{message:'Style name and template are required'});if(name.length>100||template.length>500)throw new HTTPException(400,{message:'Style is too long'});const id=crypto.randomUUID();try{await s.db.prepare('INSERT INTO starter_templates (id,workspace_id,title,description) VALUES (?,?,?,?)').bind(id,s.workspaceId,name,template).run()}catch{throw new HTTPException(409,{message:'A saved style already has that name'})}return c.json({id,title:name,description:template},201)})
  app.delete('/:id',async c=>{const s=await requireWorkspace(c),result=await s.db.prepare('DELETE FROM starter_templates WHERE workspace_id=? AND id=?').bind(s.workspaceId,c.req.param('id')).run();if(!result.meta.changes)throw new HTTPException(404,{message:'Saved style not found'});return c.body(null,204)})
  return app
}
