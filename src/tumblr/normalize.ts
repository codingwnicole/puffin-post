export interface TumblrPostReference { blogIdentifier: string; postId: string }

export function canonicalBlogIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function parseTumblrPostReference(value: string): TumblrPostReference {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Invalid Tumblr post URL') }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.tumblr\.com$/i.test(url.hostname)) throw new Error('Invalid Tumblr post URL')
  const match = /^\/post\/(\d{1,30})(?:\/|$)/.exec(url.pathname)
  if (!match) throw new Error('Invalid Tumblr post URL')
  return { blogIdentifier: canonicalBlogIdentifier(url.hostname), postId: match[1] }
}
