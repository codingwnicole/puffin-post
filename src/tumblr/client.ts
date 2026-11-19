import { oauthAuthorizationHeader } from './oauth'
import { isAllowedTumblrHost } from './ssrf-guard'
import { canonicalBlogIdentifier } from './normalize'

function postText(content?: Array<{ text?: string }>, trail?: Array<{ content?: Array<{ text?: string }> }>, fallback?: string) {
  const text = [...(content ?? []), ...(trail?.flatMap(item => item.content ?? []) ?? [])]
    .map(item => item.text ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ')
  return (text || fallback)?.slice(0, 6000)
}

export interface TumblrPost { blogIdentifier: string; id: string; rootPostId: string; rootBlogIdentifier: string; tags: string[]; title?: string; preview?: string; parserText?: string; postUrl?: string }
/** Inputs for thread-root resolution; TumblrPost satisfies it (so getPost and
 * getRecentPosts share this one resolver without raw reblog fields leaking
 * into the public post shape). */
export interface PostRootInput { blogIdentifier: string; id: string; rebloggedRootId?: string; rebloggedRootName?: string; trail?: Array<{ blog: { name: string }; post: { id: string } }> }
/** Normalise a raw Tumblr blog name to the same `name.tumblr.com` identifier the
 * client uses for its own posts. */
function blogNameToIdentifier(name: string): string {
  const bare = name.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.tumblr\.com$/i, '').replace(/\/.*$/, '')
  return bare ? `${bare}.tumblr.com` : canonicalBlogIdentifier(name)
}
/** The (blog, post) the thread this post belongs to: reblogged_root_* if Tumblr
 * gave it, else the oldest trail entry (the root), else the post itself. */
export function resolvePostThreadRoot(post: PostRootInput): { blogIdentifier: string; postId: string } {
  const trail = post.trail
  const rootId = post.rebloggedRootId || (trail && trail.length ? trail[0].post.id : post.id)
  const rootName = post.rebloggedRootName || (trail && trail.length ? trail[0].blog.name : post.blogIdentifier)
  return { blogIdentifier: blogNameToIdentifier(rootName), postId: String(rootId) }
}
export interface TumblrClient { getPost(blogIdentifier: string, postId: string): Promise<TumblrPost> }
export interface TumblrClient { getRecentPosts(blogIdentifier: string): Promise<TumblrPost[]> }
export interface TumblrBlog { identifier: string; uuid: string | null }
export interface TumblrClient { getBlogs(): Promise<TumblrBlog[]> }
/** Stored as tumblr_connections.account_metadata_json. `uuids` maps Tumblr's permanent blog id to
 * the current name, so a rename can be followed (names change; uuids don't). */
export function blogMetadata(blogs: TumblrBlog[], now = new Date()) {
  return { blogs: blogs.map(blog => blog.identifier), uuids: Object.fromEntries(blogs.filter(blog => blog.uuid).map(blog => [blog.uuid, blog.identifier])), refreshedAt: now.toISOString() }
}
export interface TumblrActivity { postId: string; blogIdentifier: string; parentBlogIdentifier: string | null; timestamp: string; tags?: string[] }
export interface TumblrClient { getThreadActivity(blogIdentifier: string, postId: string): Promise<TumblrActivity[]> }
export interface TumblrNotification { id:string; type:string; blogIdentifier:string; actor:string; timestamp:string; postId:string|null; targetPostId?:string|null; preview:string|null; sourceUrl:string|null }
export interface TumblrClient { getNotifications(blogIdentifier:string,before?:number|null):Promise<TumblrNotification[]> }
const FETCH_TIMEOUT_MS = 15_000
/** Tumblr answered 429 (app-wide limit). Carries Retry-After in seconds (60 when absent). */
export class TumblrRateLimitedError extends Error {
  constructor(readonly retryAfterSecs: number) { super('Tumblr rate limited (429)') }
}
export interface FetchBudget { remaining(): number; consume(): void }
export function createTumblrClient(config: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; fetch?: typeof fetch; budget?: FetchBudget }): TumblrClient {
  const run = config.fetch ?? fetch
  const budget = config.budget
  // S14: never let a hung Tumblr response hold a worker slot.
  const safeRun = async (url: string, init?: RequestInit) => {
    const host = new URL(url).hostname
    if (!isAllowedTumblrHost(host)) throw new Error(`Blocked Tumblr request to disallowed host: ${host}`)
    // Consume BEFORE the request goes out: parallel fetches can no longer all
    // pass remaining() first and race the budget.
    if (budget) {
      if (budget.remaining() <= 0) throw new Error('Subrequest budget exhausted')
      budget.consume()
    }
    const response = await run(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    // A 429 is Tumblr's app-wide limit, not this blog's fault. Throw a single
    // sentinel so the runner stops the whole run (not just this blog) and record
    // Retry-After on the error so the runner can hold off the next run.
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get('Retry-After')
      const retryAfter = retryAfterRaw ? Math.max(1, Math.min(86_400, Number(retryAfterRaw) || 60)) : 60
      throw new TumblrRateLimitedError(retryAfter)
    }
    return response
  }
  return { async getPost(blogIdentifier, postId) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts/${encodeURIComponent(postId)}`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr post not found')
    const body = await response.json() as { response?: { blog?: { name?: string }; id_string?: string; id?: string | number; reblogged_root_id?: string|number; reblogged_root_name?:string; reblogged_root_url?:string; tags?: string[]; summary?: string; title?: string; post_url?: string; content?: Array<{ text?: string }>; trail?: Array<{ content?: Array<{ text?: string }>; blog?: { name?: string }; post?: { id?: string | number } }> } }
    const post = body.response
    if (!post?.blog?.name || !(post.id_string ?? post.id)) throw new Error('Tumblr post not found')
    const title = (post.title ?? post.summary)?.trim().replace(/\s+/g, ' ').slice(0, 300)
    const parserText = postText(post.content, post.trail, title)
    const preview = parserText?.slice(0, 700)
    const returnedBlogIdentifier = `${post.blog.name}.tumblr.com`.toLowerCase()
    const root = resolvePostThreadRoot({ blogIdentifier: returnedBlogIdentifier, id: String(post.id_string ?? post.id), rebloggedRootId: post.reblogged_root_id == null ? undefined : String(post.reblogged_root_id), rebloggedRootName: post.reblogged_root_name, trail: post.trail?.filter(item => Boolean(item.post?.id && item.blog?.name)).map(item => ({ blog: { name: (item.blog as { name: string }).name }, post: { id: String((item.post as { id: string | number }).id) } })) })
    return { blogIdentifier:returnedBlogIdentifier, id: String(post.id_string ?? post.id), rootPostId: root.postId, rootBlogIdentifier: root.blogIdentifier, tags: post.tags ?? [], title, preview, parserText, postUrl: post.post_url }
  }, async getRecentPosts(blogIdentifier) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts?limit=20&npf=true`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error(`Tumblr recent posts failed (${response.status})`)
    const body = await response.json() as { response?: { posts?: Array<{ blog_name?: string; id_string?: string; id?: string | number; reblogged_root_id?:string|number; reblogged_root_name?:string; tags?: string[]; summary?: string; title?: string; post_url?: string; content?: Array<{ text?: string }>; trail?: Array<{ content?: Array<{ text?: string }>; blog?: { name?: string }; post?: { id?: string | number } }> }> } }
    return (body.response?.posts ?? []).flatMap(post => {
      if (!post.blog_name || (post.id_string ?? post.id) == null) return []
      const title = (post.title ?? post.summary)?.trim().replace(/\s+/g, ' ').slice(0, 300)
      const parserText = postText(post.content, post.trail, title)
      const preview = parserText?.slice(0, 700)
      const postIdentifier=`${post.blog_name}.tumblr.com`.toLowerCase()
      const root = resolvePostThreadRoot({ blogIdentifier: postIdentifier, id: String(post.id_string ?? post.id), rebloggedRootId: post.reblogged_root_id == null ? undefined : String(post.reblogged_root_id), rebloggedRootName: post.reblogged_root_name, trail: post.trail?.filter(item => Boolean(item.post?.id && item.blog?.name)).map(item => ({ blog: { name: (item.blog as { name: string }).name }, post: { id: String((item.post as { id: string | number }).id) } })) })
      return [{ blogIdentifier: postIdentifier, id: String(post.id_string ?? post.id), rootPostId: root.postId, rootBlogIdentifier: root.blogIdentifier, tags: post.tags ?? [], title, preview, parserText, postUrl: post.post_url }]
    })
  }, async getThreadActivity(blogIdentifier, postId) {
    // reblogs_with_tags: reblogs only (newest first), so a burst of likes can't push the latest reply
    // off the page. ponytail: one page; page 2 via before_timestamp if busy group threads ever need it.
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/notes?id=${encodeURIComponent(postId)}&mode=reblogs_with_tags`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error(`Tumblr refresh failed (${response.status})`)
    const body = await response.json() as { response?: { notes?: Array<{ type?:string; blog_name?: string; post_id?: string|number; reblog_parent_blog_name?:string; timestamp?: number; tags?: string[] }> } }
    return (body.response?.notes ?? []).flatMap(note => {
      if (note.type !== 'reblog' || !note.blog_name || note.post_id == null) return []
      return [{ postId:String(note.post_id), blogIdentifier:`${note.blog_name}.tumblr.com`.toLowerCase(), parentBlogIdentifier:note.reblog_parent_blog_name ? `${note.reblog_parent_blog_name}.tumblr.com`.toLowerCase() : null, timestamp:new Date((note.timestamp ?? 0) * 1000).toISOString(), tags: note.tags ?? [] }]
    })
  }, async getNotifications(blogIdentifier,before) {
    // Tumblr has renamed mention notification types over time. Request the
    // activity feed unfiltered, then keep every known current or legacy label.
    const params=new URLSearchParams({rollups:'false'})
    if(before!==null&&before!==undefined)params.set('before',String(before))
    const url=`https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/notifications?${params.toString()}`
    const response=await safeRun(url,{headers:{Authorization:await oauthAuthorizationHeader('GET',url,config.consumerKey,config.consumerSecret,config.token,config.tokenSecret)}})
    if(!response.ok) throw new Error(`Tumblr activity failed (${response.status})`)
    const body=await response.json() as {response?:{notifications?:Array<{type?:string;timestamp?:number;blog_name?:string;from_tumblelog_name?:string;from_blog_name?:string;post_id?:string|number;target_post_id?:string|number;id?:string|number;summary?:string;added_text?:string;reply_text?:string;post_url?:string;from_tumblelog?:{name?:string};from_blog?:{name?:string};blog?:{name?:string};post?:{blog_name?:string;summary?:string;title?:string;post_url?:string}}>} }
    // Reblog/reply types are kept too: the sync uses them to check threads with new replies first.
    const supported=new Set(['ask','mention','mention_in_post','mention_in_reply','user_mention','note_mention','reblog_with_content','reblog_naked','reply','conversational_note'])
    return (body.response?.notifications??[]).flatMap((item,index)=>{
      if(!item.type||!supported.has(item.type))return []
      const actor=item.from_tumblelog_name??item.from_blog_name??item.from_tumblelog?.name??item.from_blog?.name??item.blog_name??item.blog?.name??item.post?.blog_name
      const preview=(item.added_text??item.reply_text??item.summary??item.post?.summary??item.post?.title??'').trim().replace(/\s+/g,' ').slice(0,300)||null
      const actorIdentifier=actor?`${actor}.tumblr.com`.toLowerCase():'anonymous', postId=(item.post_id??item.target_post_id)==null?null:String(item.post_id??item.target_post_id)
      return [{id:String(item.id??`${item.timestamp??0}-${index}`),type:item.type,blogIdentifier,actor:actorIdentifier,timestamp:new Date((item.timestamp??0)*1000).toISOString(),postId,targetPostId:item.target_post_id==null?null:String(item.target_post_id),preview,sourceUrl:item.post_url??item.post?.post_url??(postId&&actorIdentifier!=='anonymous'?`https://www.tumblr.com/${actorIdentifier.replace(/\.tumblr\.com$/i,'')}/${postId}`:null)}]
    })
  }, async getBlogs() {
    const url = 'https://api.tumblr.com/v2/user/info'
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr account unavailable')
    const body = await response.json() as { response?: { user?: { blogs?: Array<{ name?:string; uuid?:string }> } } }
    const seen = new Set<string>(), blogs: TumblrBlog[] = []
    for (const blog of body.response?.user?.blogs ?? []) {
      if (!blog.name) continue
      const identifier = `${blog.name}.tumblr.com`.toLowerCase()
      if (seen.has(identifier)) continue
      seen.add(identifier); blogs.push({ identifier, uuid: blog.uuid ?? null })
    }
    if (!blogs.length) throw new Error('Tumblr account unavailable')
    return blogs
  } }
}
