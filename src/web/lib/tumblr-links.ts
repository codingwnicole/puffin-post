type ThreadDestination = { rootBlogId: string; rootPostId: string; latestPostId?: string | null; lastPoster?: string | null }

/** A post ID belongs to its poster, including on partner-specific branches. Never mix it with the root blog. */
export function tumblrThreadHref(thread: ThreadDestination): string | null {
  if (thread.rootBlogId === 'manual') return null
  const latest = thread.latestPostId && thread.lastPoster
    ? { blog: thread.lastPoster, post: thread.latestPostId }
    : { blog: thread.rootBlogId, post: thread.rootPostId }
  if (!latest.blog || !latest.post) return null
  return `https://www.tumblr.com/${encodeURIComponent(latest.blog.replace(/\.tumblr\.com$/i, ''))}/${encodeURIComponent(latest.post)}`
}
