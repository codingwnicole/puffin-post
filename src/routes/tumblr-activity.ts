import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { createTumblrClient, type TumblrNotification, type TumblrPost } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'

const MENTION_TYPES = new Set(['mention', 'mention_in_post', 'mention_in_reply', 'user_mention', 'note_mention'])
type ConnectedBlog = { tokenEncrypted: string; tokenSecretEncrypted: string; blogIdentifier: string }

export function tumblrActivityRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/unread-count', async c => { const scope=await requireWorkspace(c); const row=await scope.db.prepare('SELECT count(*) AS count FROM activity_notification_deliveries WHERE workspace_id=? AND seen_at IS NULL').bind(scope.workspaceId).first<{count:number}>(); return c.json({count:row?.count??0}) })
  app.post('/mark-seen', async c => { const scope=await requireWorkspace(c); await scope.db.prepare('UPDATE activity_notification_deliveries SET seen_at=? WHERE workspace_id=? AND seen_at IS NULL').bind(new Date().toISOString(),scope.workspaceId).run(); return c.body(null,204) })

  app.get('/', async c => {
    const scope = await requireWorkspace(c)
    // ?blog= filters to one canonical blog; ?before=<unix seconds> pages to older items.
    const blogFilter = c.req.query('blog') || null
    const beforeParam = c.req.query('before')
    // Accept unix seconds or the ISO oldestTimestamp the page sends back; Tumblr wants unix seconds.
    const beforeMs = !beforeParam ? NaN : /^\d+$/.test(beforeParam) ? Number(beforeParam) * 1000 : Date.parse(beforeParam)
    if (beforeParam && Number.isNaN(beforeMs)) return c.json({ error: 'before must be a unix timestamp or ISO date' }, 400)
    const before = beforeParam ? Math.floor(beforeMs / 1000) : null
    // De-duplicate by canonical blog: a blog linked by two characters/connections must be fetched once.
    const rows = await scope.db.prepare(`
      SELECT cb.blog_identifier AS blogIdentifier,
        (SELECT tc.token_encrypted FROM tumblr_connections tc
           WHERE tc.workspace_id = cb.workspace_id AND tc.id = cb.tumblr_connection_id AND tc.status = 'active'
           ORDER BY tc.created_at LIMIT 1) AS tokenEncrypted,
        (SELECT tc.token_secret_encrypted FROM tumblr_connections tc
           WHERE tc.workspace_id = cb.workspace_id AND tc.id = cb.tumblr_connection_id AND tc.status = 'active'
           ORDER BY tc.created_at LIMIT 1) AS tokenSecretEncrypted
      FROM character_blogs cb
      WHERE cb.workspace_id = ?${blogFilter ? ' AND cb.blog_identifier = ?' : ''}
        AND EXISTS (SELECT 1 FROM tumblr_connections tc WHERE tc.workspace_id = cb.workspace_id AND tc.id = cb.tumblr_connection_id AND tc.status = 'active')
      GROUP BY cb.blog_identifier
    `).bind(...(blogFilter ? [scope.workspaceId, blogFilter] : [scope.workspaceId])).all<ConnectedBlog>()
    const dismissed = await scope.db.prepare(`
      SELECT blog_identifier AS blogIdentifier, post_id AS postId
      FROM activity_dismissals WHERE workspace_id = ?
    `).bind(scope.workspaceId).all<{ blogIdentifier: string; postId: string }>()
    const dismissedPosts = new Set(dismissed.results.map(row => `${row.blogIdentifier.toLowerCase()}:${row.postId}`))
    // One query loads every post id recorded for a tracked thread in this
    // workspace (starter thread-roots, starter roots, and every branch's
    // latest post). A post is "tracked" when its resolved thread-root id is
    // in the Set OR its own id is in the Set. Tumblr post ids are globally
    // unique, so a post-id-only Set is sufficient and cheapest (one query,
    // no per-item lookups, stays under the D1 subrequest budget).
    const trackedPostIds = new Set<string>(
      (await scope.db.prepare(
        `SELECT thread_root_id AS v FROM starters WHERE workspace_id=? AND thread_root_id IS NOT NULL
         UNION SELECT root_post_id FROM starters WHERE workspace_id=? AND root_post_id IS NOT NULL
         UNION SELECT b.latest_post_id FROM reply_branches b JOIN starters s ON s.id=b.starter_id AND s.workspace_id=b.workspace_id
           WHERE b.workspace_id=? AND b.latest_post_id IS NOT NULL`
      ).bind(scope.workspaceId, scope.workspaceId, scope.workspaceId).all<{ v: string }>()
    ).results.map(row => String(row.v)))
    // Archived threads count as tracked too: they must not be re-suggested.
    const isTracked = (post: { id?: string | null; rootPostId?: string | null; threadPostIds?: string[] }) =>
      Boolean((post.rootPostId && trackedPostIds.has(String(post.rootPostId))) || (post.id && trackedPostIds.has(String(post.id))) || post.threadPostIds?.some(id => trackedPostIds.has(String(id))))
    const threadKey = (blogIdentifier: string, postId: string) => `${blogIdentifier.toLowerCase()}:${postId}`
    const responses = await Promise.all(rows.results.map(async row => {
      const client = createTumblrClient({ consumerKey: c.env.TUMBLR_CONSUMER_KEY, consumerSecret: c.env.TUMBLR_CONSUMER_SECRET, token: await decryptToken(row.tokenEncrypted, c.env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(row.tokenSecretEncrypted, c.env.TOKEN_ENCRYPTION_KEY) })
      try {
        // Only asks and mentions are shown here; reblog signals are for the background sync, and
        // looking each one up would spend Tumblr calls on nothing.
        const notifications = (await client.getNotifications(row.blogIdentifier, before)).filter(item => item.type === 'ask' || MENTION_TYPES.has(item.type))
        const enriched = await Promise.all(notifications.map(async notification => {
          if (!notification.postId || notification.actor === 'anonymous') return notification
          try {
            const post = await client.getPost(notification.actor, notification.postId)
            return { ...notification, preview: notification.preview ?? post.preview ?? post.title ?? null, sourceUrl: notification.sourceUrl ?? post.postUrl ?? null, rootPostId: post.rootPostId, rootBlogIdentifier: post.rootBlogIdentifier }
          } catch { return notification }
        }))
        // Tumblr's default notifications page is 20 items; a short page means no older items exist.
        const recentPosts = await client.getRecentPosts(row.blogIdentifier, before)
        const timestamps = [...enriched.map(notification => notification.timestamp), ...recentPosts.map(post => post.timestamp)].map(timestamp => new Date(timestamp).getTime()).filter(Number.isFinite)
        return { blogIdentifier: row.blogIdentifier, status: 'ok' as const, error: null as string | null, notifications: enriched, recentPosts, oldestTimestamp: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null, exhausted: enriched.length === 0 && recentPosts.length === 0 }
      } catch (error) {
        return { blogIdentifier: row.blogIdentifier, status: 'error' as const, error: `${row.blogIdentifier}: ${error instanceof Error ? error.message : 'Tumblr activity request failed'}`, notifications: [] as TumblrNotification[], recentPosts: [] as TumblrPost[], oldestTimestamp: null, exhausted: true }
      }
    }))
    const diagnostics = responses.flatMap(response => response.error ? [response.error] : [])
    const notifications = responses.flatMap(response => response.notifications)
      .filter(notification => !notification.postId || !dismissedPosts.has(`${notification.blogIdentifier.toLowerCase()}:${notification.postId}`))
      .filter(notification => !isTracked({ id: notification.postId, rootPostId: 'rootPostId' in notification ? notification.rootPostId : null }))
      .filter((notification, index, all) => all.findIndex(other => other.type === notification.type && other.actor === notification.actor && other.postId === notification.postId) === index)
      .map(notification => ({ ...notification, threadKey: 'rootPostId' in notification && notification.rootPostId && 'rootBlogIdentifier' in notification && notification.rootBlogIdentifier ? threadKey(String(notification.rootBlogIdentifier), String(notification.rootPostId)) : notification.postId ? threadKey(notification.actor, String(notification.postId)) : null }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const mentionTypes = MENTION_TYPES
    const threadCandidates = [...new Map(responses.flatMap(response => response.recentPosts)
      .filter(post => !isTracked(post) && !dismissedPosts.has(`${post.blogIdentifier.toLowerCase()}:${post.id}`))
      // Sort before de-duplicating so a reblog chain keeps its newest copy even
      // when Tumblr returned the source blogs in a different order.
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map(post => [threadKey(post.rootBlogIdentifier, post.rootPostId), post] as const)).values()]
      .map(post => ({ id: `post:${post.blogIdentifier}:${post.id}`, blogIdentifier: post.blogIdentifier, actor: post.blogIdentifier, timestamp: post.timestamp, postId: post.id, preview: post.preview ?? post.title ?? null, sourceUrl: post.postUrl ?? `https://www.tumblr.com/${post.blogIdentifier.replace(/\.tumblr\.com$/i, '')}/${post.id}`, threadKey: threadKey(post.rootBlogIdentifier, post.rootPostId) }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 12)
    return c.json({ asks: notifications.filter(notification => notification.type === 'ask'), mentions: notifications.filter(notification => mentionTypes.has(notification.type)), threadCandidates, blogs: responses.map(response => ({ blogIdentifier: response.blogIdentifier, status: response.status, error: response.error, oldestTimestamp: response.oldestTimestamp, exhausted: response.exhausted })), diagnostics })
  })
  app.post('/dismissals', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ blogIdentifier: z.string().min(1).max(255), postId: z.string().min(1).max(255) }).parse(await c.req.json())
    await scope.db.prepare(`
      INSERT INTO activity_dismissals (workspace_id, blog_identifier, post_id, dismissed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, blog_identifier, post_id) DO NOTHING
    `).bind(scope.workspaceId, body.blogIdentifier.toLowerCase(), body.postId, new Date().toISOString()).run()
    return c.json({ ok: true })
  })
  // Delete the dismissal row so the post reappears on the next activity GET.
  app.delete('/dismissals', async c => {
    const scope = await requireWorkspace(c)
    const body = z.object({ blogIdentifier: z.string().min(1).max(255), postId: z.string().min(1).max(255) }).parse(await c.req.json())
    await scope.db.prepare('DELETE FROM activity_dismissals WHERE workspace_id = ? AND blog_identifier = ? AND post_id = ?')
      .bind(scope.workspaceId, body.blogIdentifier.toLowerCase(), body.postId).run()
    return c.body(null, 204)
  })
  return app
}
