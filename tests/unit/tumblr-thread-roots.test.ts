// RPers trim reblog trails, so trail[0] is the partner's last reply, not the thread's first post.
// Tumblr only names the true root (reblogged_root_id) when asked with reblog_info=true.
import { describe, expect, it } from 'vitest'
import { createTumblrClient } from '../../src/tumblr/client'

const trimmedReblog = { blog_name: 'me', id_string: '300', reblogged_root_id: '100', reblogged_root_name: 'partner', trail: [{ blog: { name: 'partner' }, post: { id: '250' }, content: [{ text: 'last reply' }] }] }

function clientSeeing(urls: string[]) {
  return createTumblrClient({ consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts', fetch: (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ response: { posts: [trimmedReblog] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch })
}

describe('thread roots with trimmed trails', () => {
  it('recent posts ask for reblog info and use the true root, not the trimmed trail', async () => {
    const urls: string[] = []
    const [post] = await clientSeeing(urls).getRecentPosts('me.tumblr.com')
    expect(urls[0]).toContain('reblog_info=true')
    expect(post.rootPostId).toBe('100')
    expect(post.rootBlogIdentifier).toBe('partner.tumblr.com')
    expect(post.threadPostIds).toEqual(['300', '100', '250'])
  })
  it('a single post is read through the list endpoint with reblog info and gets the true root', async () => {
    const urls: string[] = []
    const post = await clientSeeing(urls).getPost('me.tumblr.com', '300')
    expect(urls[0]).toBe('https://api.tumblr.com/v2/blog/me.tumblr.com/posts?id=300&npf=true&reblog_info=true')
    expect(post.rootPostId).toBe('100')
  })
})
