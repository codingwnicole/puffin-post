export interface TumblrPostReference { blogIdentifier: string; postId: string }

export function normalizeTumblrTag(value: string): string {
  return value.trim().replace(/^#/, '').toLocaleLowerCase()
}

export function canonicalBlogIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function parseTumblrPostReference(value: string): TumblrPostReference {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Invalid Tumblr post URL') }
  if (url.protocol !== 'https:') throw new Error('Invalid Tumblr post URL')
  if (url.hostname === 'www.tumblr.com') {
    const match = /^\/(?:blog\/view\/)?([a-z0-9-]+)\/(\d{1,30})(?:\/|$)/i.exec(url.pathname)
    if (!match) throw new Error('Invalid Tumblr post URL')
    return { blogIdentifier: `${match[1].toLocaleLowerCase()}.tumblr.com`, postId: match[2] }
  }
  const hosted = /^([a-z0-9-]+)\.tumblr\.com$/i.exec(url.hostname)
  if (hosted) {
    const match = /^\/post\/(\d{1,30})(?:\/|$)/.exec(url.pathname)
    if (!match) throw new Error('Invalid Tumblr post URL')
    return { blogIdentifier: canonicalBlogIdentifier(url.hostname), postId: match[1] }
  }
  throw new Error('Invalid Tumblr post URL')
}
