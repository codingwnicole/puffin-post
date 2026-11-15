import { oauthAuthorizationHeader } from './oauth'
import { isAllowedTumblrHost } from './ssrf-guard'

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
export interface TumblrClient { getPost(blogIdentifier: string, postId: string): Promise<TumblrPost> }
export interface TumblrClient { getRecentPosts(blogIdentifier: string): Promise<TumblrPost[]> }
export interface TumblrClient { getBlogs(): Promise<string[]> }
export interface TumblrActivity { postId: string; blogIdentifier: string; parentBlogIdentifier: string | null; timestamp: string }
export interface TumblrClient { getThreadActivity(blogIdentifier: string, postId: string): Promise<TumblrActivity[]> }
export interface TumblrNotification { id:string; type:string; blogIdentifier:string; actor:string; timestamp:string; postId:string|null; preview:string|null; sourceUrl:string|null }
export interface TumblrClient { getNotifications(blogIdentifier:string,before?:number|null):Promise<TumblrNotification[]> }
export function createTumblrClient(config: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; fetch?: typeof fetch }): TumblrClient {
  const run = config.fetch ?? fetch
  const safeRun = (url: string, init?: RequestInit) => {
    const host = new URL(url).hostname
    if (!isAllowedTumblrHost(host)) throw new Error(`Blocked Tumblr request to disallowed host: ${host}`)
    return run(url, init)
  }
  return { async getPost(blogIdentifier, postId) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts/${encodeURIComponent(postId)}`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr post not found')
    const body = await response.json() as { response?: { blog?: { name?: string }; id_string?: string; id?: string | number; reblogged_root_id?: string|number; reblogged_root_name?:string; tags?: string[]; summary?: string; title?: string; post_url?: string; content?: Array<{ text?: string }>; trail?: Array<{ content?: Array<{ text?: string }> }> } }
    const post = body.response
    if (!post?.blog?.name || !(post.id_string ?? post.id)) throw new Error('Tumblr post not found')
    const title = (post.title ?? post.summary)?.trim().replace(/\s+/g, ' ').slice(0, 300)
    const parserText = postText(post.content, post.trail, title)
    const preview = parserText?.slice(0, 700)
    const returnedBlogIdentifier = `${post.blog.name}.tumblr.com`.toLowerCase()
    return { blogIdentifier:returnedBlogIdentifier, id: String(post.id_string ?? post.id), rootPostId:String(post.reblogged_root_id ?? post.id_string ?? post.id), rootBlogIdentifier:post.reblogged_root_name ? `${post.reblogged_root_name}.tumblr.com`.toLowerCase() : returnedBlogIdentifier, tags: post.tags ?? [], title, preview, parserText, postUrl: post.post_url }
  }, async getRecentPosts(blogIdentifier) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts?limit=20&npf=true`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error(`Tumblr recent posts failed (${response.status})`)
    const body = await response.json() as { response?: { posts?: Array<{ blog_name?: string; id_string?: string; id?: string | number; reblogged_root_id?:string|number; reblogged_root_name?:string; tags?: string[]; summary?: string; title?: string; post_url?: string; content?: Array<{ text?: string }>; trail?: Array<{ content?: Array<{ text?: string }> }> }> } }
    return (body.response?.posts ?? []).flatMap(post => {
      if (!post.blog_name || (post.id_string ?? post.id) == null) return []
      const title = (post.title ?? post.summary)?.trim().replace(/\s+/g, ' ').slice(0, 300)
      const parserText = postText(post.content, post.trail, title)
      const preview = parserText?.slice(0, 700)
      const postIdentifier=`${post.blog_name}.tumblr.com`.toLowerCase()
      return [{ blogIdentifier: postIdentifier, id: String(post.id_string ?? post.id), rootPostId:String(post.reblogged_root_id ?? post.id_string ?? post.id), rootBlogIdentifier:post.reblogged_root_name ? `${post.reblogged_root_name}.tumblr.com`.toLowerCase() : postIdentifier, tags: post.tags ?? [], title, preview, parserText, postUrl: post.post_url }]
    })
  }, async getThreadActivity(blogIdentifier, postId) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/notes?id=${encodeURIComponent(postId)}&mode=all`
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error(`Tumblr refresh failed (${response.status})`)
    const body = await response.json() as { response?: { notes?: Array<{ type?:string; blog_name?: string; post_id?: string|number; reblog_parent_blog_name?:string; timestamp?: number }> } }
    return (body.response?.notes ?? []).flatMap(note => {
      if (note.type !== 'reblog') return []
      if (!note.blog_name || note.post_id == null) return []
      return [{ postId:String(note.post_id), blogIdentifier:`${note.blog_name}.tumblr.com`.toLowerCase(), parentBlogIdentifier:note.reblog_parent_blog_name ? `${note.reblog_parent_blog_name}.tumblr.com`.toLowerCase() : null, timestamp:new Date((note.timestamp ?? 0) * 1000).toISOString() }]
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
    const supported=new Set(['ask','mention','mention_in_post','mention_in_reply','user_mention','note_mention'])
    return (body.response?.notifications??[]).flatMap((item,index)=>{
      if(!item.type||!supported.has(item.type))return []
      const actor=item.from_tumblelog_name??item.from_blog_name??item.from_tumblelog?.name??item.from_blog?.name??item.blog_name??item.blog?.name??item.post?.blog_name
      const preview=(item.added_text??item.reply_text??item.summary??item.post?.summary??item.post?.title??'').trim().replace(/\s+/g,' ').slice(0,300)||null
      const actorIdentifier=actor?`${actor}.tumblr.com`.toLowerCase():'anonymous', postId=(item.post_id??item.target_post_id)==null?null:String(item.post_id??item.target_post_id)
      return [{id:String(item.id??`${item.timestamp??0}-${index}`),type:item.type,blogIdentifier,actor:actorIdentifier,timestamp:new Date((item.timestamp??0)*1000).toISOString(),postId,preview,sourceUrl:item.post_url??item.post?.post_url??(postId&&actorIdentifier!=='anonymous'?`https://www.tumblr.com/${actorIdentifier.replace(/\.tumblr\.com$/i,'')}/${postId}`:null)}]
    })
  }, async getBlogs() {
    const url = 'https://api.tumblr.com/v2/user/info'
    const response = await safeRun(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr account unavailable')
    const body = await response.json() as { response?: { user?: { blogs?: Array<{ name?:string }> } } }
    const blogs = body.response?.user?.blogs?.map(blog => blog.name && `${blog.name}.tumblr.com`.toLowerCase()).filter((blog): blog is string => Boolean(blog)) ?? []
    if (!blogs.length) throw new Error('Tumblr account unavailable')
    return [...new Set(blogs)]
  } }
}
