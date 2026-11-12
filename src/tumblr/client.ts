import { oauthAuthorizationHeader } from './oauth'

export interface TumblrClient { getPost(blogIdentifier: string, postId: string): Promise<{ blogIdentifier: string; id: string }> }
export interface TumblrClient { getBlogs(): Promise<string[]> }
export interface TumblrActivity { postId: string; blogIdentifier: string; timestamp: string }
export interface TumblrClient { getThreadActivity(blogIdentifier: string, postId: string): Promise<TumblrActivity[]> }
export function createTumblrClient(config: { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string; fetch?: typeof fetch }): TumblrClient {
  const run = config.fetch ?? fetch
  return { async getPost(blogIdentifier, postId) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts/${encodeURIComponent(postId)}`
    const response = await run(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr post not found')
    const body = await response.json() as { response?: { blog?: { name?: string }; id_string?: string; id?: string | number } }
    const post = body.response
    if (!post?.blog?.name || !(post.id_string ?? post.id)) throw new Error('Tumblr post not found')
    return { blogIdentifier: `${post.blog.name}.tumblr.com`.toLowerCase(), id: String(post.id_string ?? post.id) }
  }, async getThreadActivity(blogIdentifier, postId) {
    const url = `https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts/${encodeURIComponent(postId)}?notes_info=true`
    const response = await run(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error(`Tumblr refresh failed (${response.status})`)
    const body = await response.json() as { response?: { notes?: Array<{ blog_name?: string; post_id?: string|number; timestamp?: number }> } }
    return (body.response?.notes ?? []).flatMap(note => {
      if (!note.blog_name || note.post_id == null) return []
      return [{ postId:String(note.post_id), blogIdentifier:`${note.blog_name}.tumblr.com`.toLowerCase(), timestamp:new Date((note.timestamp ?? 0) * 1000).toISOString() }]
    })
  }, async getBlogs() {
    const url = 'https://api.tumblr.com/v2/user/info'
    const response = await run(url, { headers: { Authorization: await oauthAuthorizationHeader('GET', url, config.consumerKey, config.consumerSecret, config.token, config.tokenSecret) } })
    if (!response.ok) throw new Error('Tumblr account unavailable')
    const body = await response.json() as { response?: { user?: { blogs?: Array<{ name?:string }> } } }
    const blogs = body.response?.user?.blogs?.map(blog => blog.name && `${blog.name}.tumblr.com`.toLowerCase()).filter((blog): blog is string => Boolean(blog)) ?? []
    if (!blogs.length) throw new Error('Tumblr account unavailable')
    return [...new Set(blogs)]
  } }
}
