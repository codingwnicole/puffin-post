import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Env } from '../worker'
import type { WorkspaceScope } from '../db/client'
import { requireWorkspace } from '../auth/sessions'
import { createStarter, getStarter, updateStarterTitle } from '../db/repositories/starters'
import { createReplyBranch, listInboxBranches, upsertReplyBranch } from '../db/repositories/branches'
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

// Build an auto-title from the character names Puffin parsed off the post.
// Used when there is no declared "who:" header, so adding a thread from
// anywhere still yields a real character name rather than a bare placeholder.
function characterTitle(own?: string | null, partners: string[] = []) {
  const ownName = own?.trim()
  if (ownName && partners.length) return [ownName, ...partners].join(' × ')
  if (partners.length) return partners.join(' × ')
  if (ownName) return ownName
  return undefined
}

function parseDeclaredCharacterNames(value?: string) {
  if (!value) return []
  const snippets: string[] = []
  const add = (candidate?: string) => { if (candidate) snippets.push(candidate) }
  add(value.match(/\b(?:who|muses?|characters?|cast)\s*:\s*([\s\S]{1,220}?)(?=\b(?:where|when|verse|setting|plot|notes?)\s*:|$)/i)?.[1])
  for (const match of value.matchAll(/\b(?:gifted|closed|open)?\s*starter\s+(?:for|to)\s*[:—-]*\s*([^(@\n]{2,80})/gi)) add(match[1])
  for (const match of value.matchAll(/\bgifted\s+for\s*[:—-]*\s*([^(@\n]{2,80})/gi)) add(match[1])
  for (const match of value.matchAll(/\b(?:ft\.?|featuring)\s*[:—-]*\s*([^(@\n]{2,80})/gi)) add(match[1])
  // Common compact format: "scene title, kit & diana @writingblog".
  for (const match of value.matchAll(/,\s*([\p{L}][\p{L}' -]*(?:\s*(?:&|\bx\b|\band\b|,)\s*[\p{L}][\p{L}' -]*)+)\s*@\w+/giu)) add(match[1])
  return snippets.flatMap(snippet => snippet
    .replace(/@[\w-]+/g, '')
    .replace(/\b(?:ft\.?|featuring|with)\b/gi, '')
    .split(/\s*(?:\+|\/|&|\bx\b|\band\b|,)\s*/i)
    .map(name => name.replace(/[()[\]{}]/g, '').replace(/\s+/g, ' ').trim())
    .filter(name => /^[\p{L}][\p{L}' -]{1,60}$/u.test(name)))
    .filter((name, index, all) => all.findIndex(other => other.localeCompare(name, undefined, { sensitivity:'accent' }) === 0) === index)
}

async function applyPostTags(scope: WorkspaceScope, starterId: string, postTags: string[]) {
  for (const raw of postTags) {
    const label = raw?.trim()
    if (!label) continue
    const normalized = label.toLocaleLowerCase()
    let tag = await scope.db.prepare('SELECT id FROM tags WHERE workspace_id=? AND normalized_label=?').bind(scope.workspaceId, normalized).first<{ id: string }>()
    if (!tag) {
      const id = crypto.randomUUID()
      await scope.db.prepare('INSERT OR IGNORE INTO tags (id, workspace_id, normalized_label, display_label, color) VALUES (?,?,?,?,?)').bind(id, scope.workspaceId, normalized, label, null).run()
      tag = await scope.db.prepare('SELECT id FROM tags WHERE workspace_id=? AND normalized_label=?').bind(scope.workspaceId, normalized).first<{ id: string }>()
      if (!tag) continue
    }
    await scope.db.prepare('INSERT OR IGNORE INTO starter_tags (workspace_id, starter_id, tag_id) VALUES (?,?,?)').bind(scope.workspaceId, starterId, tag.id).run()
  }
}

export function starterRoutes() {
  const app = new Hono<{ Bindings:Env }>()

  async function findPost(scope:Awaited<ReturnType<typeof requireWorkspace>>, env:Env, postUrl:string, characterId?:string) {
    const reference = parseTumblrPostReference(postUrl)
    const access = await scope.db.prepare(`SELECT tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted
      FROM tumblr_connections tc ${characterId ? 'JOIN character_blogs access_blog ON access_blog.workspace_id=tc.workspace_id AND access_blog.tumblr_connection_id=tc.id' : ''}
      WHERE tc.workspace_id=? AND tc.status='active' ${characterId ? 'AND access_blog.character_id=?' : ''} LIMIT 1`)
      .bind(...[scope.workspaceId, ...(characterId ? [characterId] : [])]).first<{tokenEncrypted:string;tokenSecretEncrypted:string}>()
    // Without an active connection we can't read the post from Tumblr. A
    // link-less (manual) scene never calls findPost, so reaching here with no
    // connection is a programming error — fail loudly rather than casting null.
    if (!access) throw new HTTPException(500, { message:'No active Tumblr connection' })
    const connection: {tokenEncrypted:string;tokenSecretEncrypted:string} = access

    const rules = await scope.db.prepare(`SELECT cb.id, cb.character_id AS characterId, cb.character_tag AS characterTag, c.name AS characterName
      FROM character_blogs cb JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
      JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
      WHERE cb.workspace_id=? AND cb.blog_identifier=? AND tc.status='active'`).bind(scope.workspaceId, reference.blogIdentifier).all<Assignment>()
    const client = createTumblrClient({ consumerKey:env.TUMBLR_CONSUMER_KEY, consumerSecret:env.TUMBLR_CONSUMER_SECRET,
      token:await decryptToken(connection.tokenEncrypted,env.TOKEN_ENCRYPTION_KEY), tokenSecret:await decryptToken(connection.tokenSecretEncrypted,env.TOKEN_ENCRYPTION_KEY) })
    const clickedPost = await client.getPost(reference.blogIdentifier, reference.postId)
    if (canonicalBlogIdentifier(clickedPost.blogIdentifier) !== reference.blogIdentifier || clickedPost.id !== reference.postId) throw new HTTPException(400, { message:'Tumblr post could not be verified' })
    // Activity can point at the user's own reblog. Its wrapper often has no RP
    // header, so read the root starter for character/title extraction instead.
    const post = clickedPost.rootPostId !== clickedPost.id || clickedPost.rootBlogIdentifier !== clickedPost.blogIdentifier
      ? await client.getPost(clickedPost.rootBlogIdentifier, clickedPost.rootPostId).catch(() => clickedPost)
      : clickedPost
    const tags = new Set([...clickedPost.tags, ...post.tags].map(normalizeTumblrTag))
    const candidates = rules.results.filter(rule => !rule.characterTag || tags.has(rule.characterTag)).map(rule => ({ characterId:rule.characterId, characterName:rule.characterName, characterTag:rule.characterTag }))
    const ownBlogs = characterId ? await scope.db.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId,characterId).all<{blogIdentifier:string}>() : { results:[] as {blogIdentifier:string}[] }
    const ownBlogIdentifiers = new Set(ownBlogs.results.map(blog => canonicalBlogIdentifier(blog.blogIdentifier)))
    const activities = await client.getThreadActivity(clickedPost.rootBlogIdentifier, clickedPost.rootPostId)
    const participants = new Set(activities.map(activity => activity.blogIdentifier).filter(blog => !ownBlogIdentifiers.has(blog)))
    if (!ownBlogIdentifiers.has(clickedPost.rootBlogIdentifier)) participants.add(clickedPost.rootBlogIdentifier)
    const selectedCharacter = characterId ? await scope.db.prepare('SELECT name FROM characters WHERE workspace_id=? AND id=?').bind(scope.workspaceId, characterId).first<{name:string}>() : null
    // Some groups put the RP header on the tagged reblog; others put it on the
    // original starter. Read both, in that order, so neither convention loses.
    const parserSource = [clickedPost.parserText ?? clickedPost.preview, post.parserText ?? post.preview].filter(Boolean).join('\n')
    const who = parserSource?.match(/\bwho\s*:\s*(.+?)(?=\bwhere\s*:|$)/i)?.[1]?.trim()
    const where = parserSource?.match(/\bwhere\s*:\s*(.+?)(?=$)/i)?.[1]?.trim()
    const suggestedTitle = selectedCharacter?.name ? `${selectedCharacter.name}${who ? ` × ${who.replace(/@[^\s,]+/g, '').replace(/\bft\.?\b/i, '').replace(/\s+/g, ' ').replace(/^\W+|\W+$/g, '') || 'writing partner'}` : ''}${where ? ` — ${where}` : ''}` : post.title
    const parsedCharacterNames = parseDeclaredCharacterNames(parserSource)
    const partnerNames = parsedCharacterNames.filter(name => name.localeCompare(selectedCharacter?.name ?? '', undefined, { sensitivity:'accent' }) !== 0)
    const parsedTitle = selectedCharacter?.name && partnerNames.length ? `${selectedCharacter.name} × ${partnerNames.join(' × ')}${where ? ` — ${where}` : ''}` : undefined
    return { client, reference, tags:[...tags], candidates, title:post.title, characterName:selectedCharacter?.name, suggestedTitle:parsedTitle ?? suggestedTitle, parsedCharacterNames, preview:post.preview, sourceBlogIdentifier:reference.blogIdentifier, sourceBlogAssigned:rules.results.length > 0, participants:[...participants].sort(), activities, ownBlogIdentifiers:[...ownBlogIdentifiers], threadRootId:clickedPost.rootPostId, threadRootBlogId:clickedPost.rootBlogIdentifier }
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
    // A post link needs the character's Tumblr blog to verify the post. A
    // link-less (manual) scene never touches Tumblr, so it is allowed through.
    if (input.postUrl) {
      const hasBlog = await scope.db.prepare('SELECT 1 FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(scope.workspaceId,input.characterId).first()
      if (!hasBlog) throw new HTTPException(400, { message:input.characterId ? 'Assign a Tumblr blog to this character before tracking a thread' : 'Connect a Tumblr account before tracking posts' })
    }
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
    const latest = found && partnerBlog ? latestDirectExchange(found.ownBlogIdentifiers,found.threadRootBlogId,partnerBlog,found.activities) : undefined
    const latestPost = latest && found ? await found.client.getPost(latest.activity.blogIdentifier, latest.activity.postId).catch(() => null) : null
    const manualId=crypto.randomUUID()
    const starter = await createStarter({ ...scope, characterId:input.characterId, groupId, title:input.title || found?.suggestedTitle || characterTitle(found?.characterName, found?.parsedCharacterNames) || found?.title || (found ? 'Tumblr thread' : 'Untitled scene'), rootBlogId:found?.reference.blogIdentifier ?? 'manual', rootPostId:found?.reference.postId ?? manualId, threadRootId:found?.threadRootId ?? manualId, threadRootBlogId:found?.threadRootBlogId ?? 'manual', description:input.description?.trim() || compactThreadSummary(latestPost?.preview ?? found?.preview) })
    const partnerId=partnerBlog ? await findOrCreatePartner(scope,partnerBlog) : input.partnerName?.trim() ? await findOrCreateManualPartner(scope,input.partnerName) : null
    if (found?.tags?.length) await applyPostTags(scope, starter.id, found.tags)
    const branch = (partnerId || !found)
      ? await upsertReplyBranch({ ...scope, starterId: starter.id, partnerId, status: latest?.status ?? 'your_turn', latestPostId: latest?.activity.postId, lastPoster: latest?.activity.blogIdentifier, lastActivityAt: latest?.activity.timestamp })
      : null
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
  app.post('/:starterId/reparse', async c => {
    const scope = await requireWorkspace(c)
    const starter = await getStarter(scope, c.req.param('starterId'))
    if (starter.rootBlogId === 'manual') throw new HTTPException(400, { message:'Manual scenes do not have a Tumblr post to read' })
    const found = await findPost(scope, c.env, `https://www.tumblr.com/${starter.rootBlogId.replace(/\.tumblr\.com$/i, '')}/${starter.rootPostId}`, starter.characterId)
    if (!found.parsedCharacterNames.length) throw new HTTPException(400, { message:'Puffin could not find declared character names in this post yet' })
    return c.json(await updateStarterTitle(scope, starter.id, found.suggestedTitle || starter.title, compactThreadSummary(found.preview) || starter.description))
  })
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
