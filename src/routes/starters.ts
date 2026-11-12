import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createStarter, getStarter } from '../db/repositories/starters'
import { createReplyBranch, listInboxBranches } from '../db/repositories/branches'
import { branchSchema, starterSchema } from './tracking-validation'
import { canonicalBlogIdentifier } from '../tumblr/normalize'
import { HTTPException } from 'hono/http-exception'
import { createTumblrClient } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'

export function starterRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/options', async c => {
    const scope = await requireWorkspace(c)
    const [characters,partners] = await Promise.all([
      scope.db.prepare('SELECT id,name FROM characters WHERE workspace_id=? ORDER BY name').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,display_label AS name FROM partners WHERE workspace_id=? ORDER BY display_label').bind(scope.workspaceId).all(),
    ])
    return c.json({ characters: characters.results, partners: partners.results })
  })
  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const input = starterSchema.parse(await c.req.json())
    // A connected character may only create starters from one of its selected blogs.
    // Empty legacy/manual setups stay usable until the connection wizard attaches a blog.
    const blogs = await scope.db.prepare(`SELECT cb.blog_identifier, tc.token_encrypted, tc.token_secret_encrypted
      FROM character_blogs cb JOIN tumblr_connections tc ON tc.id=cb.tumblr_connection_id AND tc.workspace_id=cb.workspace_id
      WHERE cb.workspace_id=? AND cb.character_id=?`).bind(scope.workspaceId, input.characterId).all<{ blog_identifier:string; token_encrypted:string; token_secret_encrypted:string }>()
    if (blogs.results.length && !blogs.results.some(blog => canonicalBlogIdentifier(blog.blog_identifier) === canonicalBlogIdentifier(input.rootBlogId))) {
      throw new HTTPException(400, { message:'Post does not belong to the selected blog' })
    }
    const assigned = blogs.results.find(blog => canonicalBlogIdentifier(blog.blog_identifier) === canonicalBlogIdentifier(input.rootBlogId))
    if (assigned) {
      const client = createTumblrClient({ consumerKey:c.env.TUMBLR_CONSUMER_KEY, consumerSecret:c.env.TUMBLR_CONSUMER_SECRET,
        token:await decryptToken(assigned.token_encrypted,c.env.TOKEN_ENCRYPTION_KEY), tokenSecret:await decryptToken(assigned.token_secret_encrypted,c.env.TOKEN_ENCRYPTION_KEY) })
      try {
        const post = await client.getPost(canonicalBlogIdentifier(input.rootBlogId), input.rootPostId)
        if (canonicalBlogIdentifier(post.blogIdentifier) !== canonicalBlogIdentifier(input.rootBlogId) || post.id !== input.rootPostId) throw new Error('mismatch')
      } catch { throw new HTTPException(400, { message:'Tumblr post does not belong to the selected blog' }) }
    }
    return c.json(await createStarter({ ...scope,...input }),201)
  })
  app.get('/:starterId', async c => {
    const scope = await requireWorkspace(c), id = c.req.param('starterId')
    return c.json({ starter: await getStarter(scope,id), branches: await listInboxBranches({ ...scope,starterId:id,includeArchived:true }) })
  })
  app.post('/:starterId/branches', async c => {
    const scope = await requireWorkspace(c)
    return c.json(await createReplyBranch({ ...scope,starterId:c.req.param('starterId'),...branchSchema.parse(await c.req.json()) }),201)
  })
  return app
}
