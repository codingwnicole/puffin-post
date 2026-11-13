import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createStarter, getStarter, updateStarterTitle } from '../db/repositories/starters'
import { createReplyBranch, listInboxBranches } from '../db/repositories/branches'
import { branchSchema, starterSchema } from './tracking-validation'
import { canonicalBlogIdentifier, normalizeTumblrTag, parseTumblrPostReference } from '../tumblr/normalize'
import { createTumblrClient } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'
import { latestDirectExchange } from '../tumblr/refresh'

type Assignment = { id:string; characterId:string; characterTag:string|null; characterName:string }

function compactThreadSummary(value?: string) {
  if (!value) return ''
  const cleaned = value.replace(/\s+/g, ' ').trim()
  const sentences = cleaned.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')
  return sentences.length > 360 ? `${sentences.slice(0, 357).trimEnd()}…` : sentences
}

function parseDeclaredCharacterNames(value?: string) {
  if (!value) return []
  const header = value.match(/\b(?:who|muses?|characters?|cast)\s*:\s*([\s\S]{1,220}?)(?=\b(?:where|when|verse|setting|plot|notes?)\s*:|$)/i)?.[1]
  if (!header) return []
  return header
    .replace(/@[\w-]+/g, '')
    .replace(/\b(?:ft\.?|featuring|with)\b/gi, '')
    .split(/\s*(?:\+|\/|&|\bx\b|\band\b|,)\s*/i)
    .map(name => name.replace(/[()[\]{}]/g, '').replace(/\s+/g, ' ').trim())
    .filter(name => /^[\p{L}][\p{L}' -]{1,60}$/u.test(name))
    .filter((name, index, all) => all.findIndex(other => other.localeCompare(name, undefined, { sensitivity:'accent' }) === 0) === index)
}

export function starterRoutes() {
  const app = new Hono<{ Bindings:Env }>()

  async function findPost(scope:Awaited<ReturnType<typeof requireWorkspace>>, env:Env, postUrl:string, characterId?:string) {
    const reference = parseTumblrPostReference(postUrl)
    const access = await scope.db.prepare(`SELECT tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted
      FROM tumblr_connections tc ${characterId ? 'JOIN character_blogs access_blog ON access_blog.workspace_id=tc.workspace_id AND access_blog.tumblr_connection_id=tc.id' : ''}
      WHERE tc.workspace_id=? AND tc.status='active' ${characterId ? 'AND access_blog.character_id=?' : ''} LIMIT 1`)
      .bind(...[scope.workspaceId, ...(characterId ? [characterId] : [])]).first<{tokenEncrypted:string;tokenSecretEncrypted:string}>()
    if (!access) throw new HTTPException(400, { message:characterId ? 'Assign a Tumblr blog to this character before tracking a thread' : 'Connect a Tumblr account before tracking posts' })

    const rules = await scope.db.prepare(`SELECT cb.id, cb.character_id AS characterId, cb.character_tag AS characterTag, c.name AS characterName
      FROM character_blogs cb JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
      JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
      WHERE cb.workspace_id=? AND cb.blog_identifier=? AND tc.status='active'`).bind(scope.workspaceId, reference.blogIdentifier).all<Assignment>()
    const client = createTumblrClient({ consumerKey:env.TUMBLR_CONSUMER_KEY, consumerSecret:env.TUMBLR_CONSUMER_SECRET,
      token:await decryptToken(access.tokenEncrypted,env.TOKEN_ENCRYPTION_KEY), tokenSecret:await decryptToken(access.tokenSecretEncrypted,env.TOKEN_ENCRYPTION_KEY) })
    const post = await client.getPost(reference.blogIdentifier, reference.postId)
    if (canonicalBlogIdentifier(post.blogIdentifier) !== reference.blogIdentifier || post.id !== reference.postId) throw new HTTPException(400, { message:'Tumblr post could not be verified' })
    const tags = new Set(post.tags.map(normalizeTumblrTag))
    const candidates = rules.results.filter(rule => !rule.characterTag || tags.has(rule.characterTag)).map(rule => ({ characterId:rule.characterId, characterName:rule.characterName, characterTag:rule.characterTag }))
    const ownBlogs = characterId ? await scope.db.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId,characterId).all<{blogIdentifier:string}>() : { results:[] as {blogIdentifier:string}[] }
    const ownBlogIdentifiers = new Set(ownBlogs.results.map(blog => canonicalBlogIdentifier(blog.blogIdentifier)))
    const activities = await client.getThreadActivity(reference.blogIdentifier,reference.postId)
    const participants = new Set(activities.map(activity => activity.blogIdentifier).filter(blog => !ownBlogIdentifiers.has(blog)))
    if (!ownBlogIdentifiers.has(reference.blogIdentifier)) participants.add(reference.blogIdentifier)
    const selectedCharacter = characterId ? await scope.db.prepare('SELECT name FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId, characterId).first<{name:string}>() : null
    const who = post.preview?.match(/\bwho\s*:\s*(.+?)(?=\bwhere\s*:|$)/i)?.[1]?.trim()
    const where = post.preview?.match(/\bwhere\s*:\s*(.+?)(?=$)/i)?.[1]?.trim()
    const suggestedTitle = selectedCharacter?.name ? `${selectedCharacter.name}${who ? ` × ${who.replace(/@[^\s,]+/g, '').replace(/\bft\.?\b/i, '').replace(/\s+/g, ' ').replace(/^\W+|\W+$/g, '') || 'writing partner'}` : ''}${where ? ` — ${where}` : ''}` : post.title
    const parsedCharacterNames = parseDeclaredCharacterNames(post.preview)
    const partnerNames = parsedCharacterNames.filter(name => name.localeCompare(selectedCharacter?.name ?? '', undefined, { sensitivity:'accent' }) !== 0)
    const parsedTitle = selectedCharacter?.name && partnerNames.length ? `${selectedCharacter.name} × ${partnerNames.join(' × ')}${where ? ` — ${where}` : ''}` : undefined
    return { client, reference, tags:[...tags], candidates, title:post.title, suggestedTitle:parsedTitle ?? suggestedTitle, parsedCharacterNames, preview:post.preview, sourceBlogIdentifier:reference.blogIdentifier, sourceBlogAssigned:rules.results.length > 0, participants:[...participants].sort(), activities, ownBlogIdentifiers:[...ownBlogIdentifiers], threadRootId:post.rootPostId, threadRootBlogId:post.rootBlogIdentifier }
  }

  async function findOrCreatePartner(scope:Awaited<ReturnType<typeof requireWorkspace>>, blogIdentifier:string) {
    const blog = canonicalBlogIdentifier(blogIdentifier)
    const existing = await scope.db.prepare('SELECT id FROM partners WHERE workspace_id=? AND blog_identifier=?').bind(scope.workspaceId,blog).first<{id:string}>()
    if (existing) return existing.id
    const id = crypto.randomUUID()
    await scope.db.prepare('INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES (?,?,?,?)').bind(id,scope.workspaceId,blog,blog).run()
    return id
  }

  async function findOrCreateManualPartner(scope:Awaited<ReturnType<typeof requireWorkspace>>, label:string) {
    const displayLabel=label.trim()
    const existing=await scope.db.prepare('SELECT id FROM partners WHERE workspace_id=? AND lower(display_label)=lower(?) LIMIT 1').bind(scope.workspaceId,displayLabel).first<{id:string}>()
    if(existing)return existing.id
    const id=crypto.randomUUID()
    await scope.db.prepare('INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES (?,?,?,?)').bind(id,scope.workspaceId,`manual:${id}`,displayLabel).run()
    return id
  }

  app.get('/options', async c => {
    const scope = await requireWorkspace(c)
    const [characters, partners, groups] = await Promise.all([
      scope.db.prepare('SELECT id,name FROM characters WHERE workspace_id=? ORDER BY name').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,display_label AS name FROM partners WHERE workspace_id=? ORDER BY display_label').bind(scope.workspaceId).all(),
      scope.db.prepare('SELECT id,name FROM rp_groups WHERE workspace_id=? ORDER BY name COLLATE NOCASE').bind(scope.workspaceId).all(),
    ])
    return c.json({ characters:characters.results, partners:partners.results, groups:groups.results })
  })

  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const input = starterSchema.parse(await c.req.json())
    const character = await scope.db.prepare('SELECT id FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,input.characterId).first()
    if (!character) throw new HTTPException(404, { message:'Character not found' })
    const found = input.postUrl ? await findPost(scope, c.env, input.postUrl, input.characterId) : null
    if (!found && !input.title?.trim()) throw new HTTPException(400, { message:'Give this manual thread a scene label' })
    const memberships=await scope.db.prepare('SELECT group_id AS groupId FROM rp_group_characters WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId,input.characterId).all<{groupId:string}>()
    const groupId=input.groupId ?? (memberships.results.length===1?memberships.results[0].groupId:null)
    if (groupId && !memberships.results.some(group=>group.groupId===groupId)) throw new HTTPException(400, { message:'Add this character to the RP section first' })
    // A tagged post can be a starter written on another person's blog, a shared-blog
    // post without a character tag, or a post Tumblr reports through an activity URL.
    // The person looking at it is the authority on which of their characters it is for;
    // character-blog rules help discover posts, but must never block that choice here.
    // Puffin can infer a sole participant. With several, it must ask which exchange
    // matters instead of silently tracking the wrong reblog chain.
    const partnerBlog = found && (input.partnerBlogIdentifier ? canonicalBlogIdentifier(input.partnerBlogIdentifier) : found.participants.length === 1 ? found.participants[0] : null)
    if (found && found.participants.length > 1 && !partnerBlog) throw new HTTPException(400, { message:'Choose the writing partner for this thread' })
    if (found && partnerBlog && !found.participants.includes(partnerBlog)) throw new HTTPException(400, { message:'Choose a writing partner detected on this thread' })
    const latest = found && partnerBlog ? latestDirectExchange(found.ownBlogIdentifiers,found.reference.blogIdentifier,partnerBlog,found.activities) : undefined
    const latestPost = latest && found ? await found.client.getPost(latest.activity.blogIdentifier, latest.activity.postId).catch(() => null) : null
    const manualId=crypto.randomUUID()
    const starter = await createStarter({ ...scope, characterId:input.characterId, groupId, title:input.title || found?.title || (found ? 'Tumblr thread' : 'Untitled scene'), rootBlogId:found?.reference.blogIdentifier ?? 'manual', rootPostId:found?.reference.postId ?? manualId, threadRootId:found?.threadRootId ?? manualId, threadRootBlogId:found?.threadRootBlogId ?? 'manual', description:input.description?.trim() || compactThreadSummary(latestPost?.preview ?? found?.preview) })
    const partnerId=partnerBlog ? await findOrCreatePartner(scope,partnerBlog) : input.partnerName?.trim() ? await findOrCreateManualPartner(scope,input.partnerName) : null
    const branch = (partnerId || !found) ? await createReplyBranch({ ...scope, starterId:starter.id, partnerId, status:latest?.status ?? 'your_turn', latestPostId:latest?.activity.postId, lastPoster:latest?.activity.blogIdentifier, lastActivityAt:latest?.activity.timestamp }) : null
    return c.json({ ...starter, branch }, 201)
  })

  app.post('/resolve', async c => {
    const scope = await requireWorkspace(c)
    const body = await c.req.json<{ postUrl?:string; characterId?:string }>()
    if (!body.postUrl) throw new HTTPException(400, { message:'Paste a Tumblr post link' })
    const { client: _client, ...resolved } = await findPost(scope, c.env, body.postUrl, body.characterId)
    return c.json(resolved)
  })
  app.patch('/:starterId', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ title:z.string().trim().min(1).max(300), description:z.string().max(20000).optional() }).strict().parse(await c.req.json())
    return c.json(await updateStarterTitle(scope, c.req.param('starterId'), body.title, body.description ?? ''))
  })
  app.get('/:starterId', async c => { const scope = await requireWorkspace(c), id = c.req.param('starterId'); return c.json({ starter:await getStarter(scope,id), branches:await listInboxBranches({ ...scope,starterId:id,includeArchived:true }) }) })
  app.delete('/:starterId', async c => {
    const scope=await requireWorkspace(c),id=c.req.param('starterId')
    if(!await scope.db.prepare('SELECT id FROM starters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,id).first()) throw new HTTPException(404,{message:'Starter not found'})
    await scope.db.batch([
      scope.db.prepare('DELETE FROM reply_drafts WHERE workspace_id=? AND converted_starter_id=?').bind(scope.workspaceId,id),
      scope.db.prepare('DELETE FROM activities WHERE workspace_id=? AND starter_id=?').bind(scope.workspaceId,id),
      scope.db.prepare('DELETE FROM starter_tags WHERE workspace_id=? AND starter_id=?').bind(scope.workspaceId,id),
      scope.db.prepare('DELETE FROM reply_branches WHERE workspace_id=? AND starter_id=?').bind(scope.workspaceId,id),
      scope.db.prepare('DELETE FROM starters WHERE workspace_id=? AND id=?').bind(scope.workspaceId,id),
    ])
    return c.body(null,204)
  })
  app.post('/:starterId/branches', async c => { const scope = await requireWorkspace(c); return c.json(await createReplyBranch({ ...scope,starterId:c.req.param('starterId'),...branchSchema.parse(await c.req.json()) }),201) })
  return app
}
