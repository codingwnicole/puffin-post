import type { Env } from '../worker'
import { createTumblrClient, TumblrRateLimitedError, type FetchBudget } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'
import { canonicalBlogIdentifier } from '../tumblr/normalize'
import { refreshStarterBranches, type RefreshBranch } from '../tumblr/refresh'
import { sendWorkspacePush } from '../routes/push'
import { redact } from '../shared/redact'

export interface RefreshBatchResult { selected: number; refreshed: number; failed: number; skipped?: number; fetchesUsed?: number; d1Used?: number; rateLimited?: boolean }

// Trim a reply's preview to at most 500 chars, breaking on a word boundary so
// a stored excerpt never ends mid-word. Returns null for empty input.
export function replyExcerpt(preview: string | null | undefined): string | null {
  const text = (preview ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= 500) return text
  const cut = text.slice(0, 500)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()
}
interface RefreshTarget { leadsCharacter: number; id: string; workspaceId: string; characterId: string; blogIdentifier: string; connectionId: string; tokenEncrypted: string; tokenSecretEncrypted: string }
interface StarterRow { id: string; rootPostId: string; rootBlogId: string }
interface BranchRow extends RefreshBranch { starterId: string; lastRefreshAt: string | null }

// Cloudflare free plan: 50 fetch subrequests per invocation AND a SEPARATE
// 1,000 for Cloudflare services (D1). Sized independently: fetches default to
// 30 (sendDuePushes shares the invocation with its own fetches, so hold back)
// and D1 gets its own internal cap of 800 (headroom under 1,000). Override the
// fetch budget via env REFRESH_FETCH_BUDGET (paid plans); the owner can raise
// the ceiling without a code change.
const SUBREQUEST_BUDGET = 30
const D1_BUDGET_LIMIT = 800
// ponytail: ceiling is up to 60 blogs per run x 2 runs/hour (cron every 30 min), bounded
// by the fetch budget, not D1. The hard outside limit is Tumblr's documented 1,000 calls/hour
// and 5,000/day per consumer key, shared by every user and interactive use: 48 runs/day x
// budget must stay well under that (REFRESH_FETCH_BUDGET=60 is ~2,880/day). Higher needs
// Tumblr to raise the app's limit on request. Upgrade path if a single invocation must do more:
// Cloudflare Queues fan-out per connection, so each workspace's due blogs run
// as independent jobs.
function readFetchBudget(env: Env, explicit?: number): number {
  if (explicit !== undefined) return Math.max(1, Math.min(900, explicit))
  const raw = env.REFRESH_FETCH_BUDGET
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : SUBREQUEST_BUDGET
  return Math.max(1, Math.min(900, value))
}
// The target and starter loops stop with this many subrequests still free, so
// the per-target write batch (1) and the scheduler-state batch (1) always fit.
const FINAL_WRITE_HEADROOM = 2

// Counts every outbound fetch and every D1 statement in the run. The two pools
// are independent (see above); remaining() is the smaller pool left, so a run
// can't overdraw either.
class SubrequestBudget {
  private d1 = 0
  private fetches = 0
  constructor(private readonly cap: number) {}
  remaining(): number { return Math.max(0, Math.min(this.cap - this.fetches, D1_BUDGET_LIMIT - this.d1)) }
  consumeD1(): void { this.d1 += 1 }
  consume(): void { this.fetches += 1 }
  used(): { fetches: number; d1: number } { return { fetches: this.fetches, d1: this.d1 } }
}

// Wraps a D1Database so every D1 statement (run/all/first/batch) consumes one
// D1 subrequest. prepare() is free in D1 — only executing a statement counts.
// bind() returns a wrapped statement too, so a bound query (.bind().all()) is
// counted when it runs; batch() unwraps to the raw statements and counts once.
function countingDB(db: D1Database, budget: SubrequestBudget): D1Database {
  const wrap = (stmt: any): any => ({
    raw: stmt,
    bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
    run: async (...args: unknown[]) => { budget.consumeD1(); return stmt.run(...args) },
    all: async (...args: unknown[]) => { budget.consumeD1(); return stmt.all(...args) },
    first: async (...args: unknown[]) => { budget.consumeD1(); return stmt.first(...args) },
  })
  const prepare = (sql: string): D1PreparedStatement => wrap(db.prepare(sql))
  return { ...db, prepare, batch: (stmts: D1PreparedStatement[]) => { budget.consumeD1(); return db.batch(stmts.map(s => (s as any).raw ?? s)) } } as unknown as D1Database
}

export async function runRefreshBatch(env: Env, now: Date, limit: number, options: { fetchBudget?: number; targetLimit?: number; runId?: string } = {}): Promise<RefreshBatchResult> {
  // Overlap guard: the caller (the scheduled handler) supplies a run id that
  // identifies the invocation. A second scheduled batch for the same workspace
  // while the first is still running sees the live lock and bails out, so the
  // same blog is never refreshed twice in one window. The lock is released by
  // the finishing run (or expires once started_at ages past 10 min).
  // ponytail: one global lock (any unfinished run younger than 10 min blocks); per-connection locks if runs ever need to overlap.
  const runId = options.runId ?? crypto.randomUUID()
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString()
  const claimed = await env.DB.prepare('INSERT INTO refresh_runs (id,started_at,finished_at) SELECT ?,?,NULL WHERE NOT EXISTS (SELECT 1 FROM refresh_runs WHERE finished_at IS NULL AND started_at > ?)').bind(runId, now.toISOString(), staleBefore).run()
  if (!claimed.meta.changes) return { selected: 0, refreshed: 0, failed: 0, skipped: 0, fetchesUsed: 0 }
  await env.DB.prepare('DELETE FROM refresh_runs WHERE id<>? AND started_at < ?').bind(runId, new Date(now.getTime() - 86_400_000).toISOString()).run()
  // Declared at function scope so the finally can stamp due/refreshed even if
  // the run throws mid-batch.
  let dueTargets = 0
  let refreshed = 0
  let rateLimited = false
  let retryAfterSecs: number | null = null
  try {
    const budget = new SubrequestBudget(readFetchBudget(env, options.fetchBudget))
  const db = countingDB(env.DB, budget)
  // Honor a Retry-After from a previous run: Tumblr told us not to start another
  // run before this timestamp, so bail before doing any work.
  const rateLimitedUntil = (await db.prepare('SELECT rate_limited_until AS until FROM refresh_scheduler_state WHERE id=1').first<{ until: string | null }>())?.until ?? null
  if (rateLimitedUntil && Date.parse(rateLimitedUntil) > now.getTime()) {
    return { selected: 0, refreshed: 0, failed: 0, skipped: 0, fetchesUsed: 0, d1Used: budget.used().d1, rateLimited: true }
  }
  const effectiveLimit = Math.max(1, Math.min(limit, options.targetLimit ?? limit))
  // Fairness across strangers: rank each workspace's targets by staleness (never-tried first,
  // then oldest last attempt), then take rank 1 of every workspace before anyone's rank 2.
  // Within a round the stalest blog leads, so a workspace with 200 blogs cannot starve a
  // 1-blog user, and every blog inside a big workspace still comes up in turn.
  // ponytail: up to 60 targets per run, bounded by the fetch budget; see the ceiling note above.
  const candidates = await db.prepare(`SELECT id, leadsCharacter, workspaceId, characterId, blogIdentifier, connectionId, tokenEncrypted, tokenSecretEncrypted, totalDue FROM (
    SELECT cb.id, cb.workspace_id AS workspaceId, cb.character_id AS characterId, cb.blog_identifier AS blogIdentifier, tc.id AS connectionId,
      tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted,
      COALESCE(rc.last_attempt_at, '') AS lastAttempt,
      -- The lead is the lowest-id blog that can run now: a disconnected or backing-off first blog must not strand the character's threads.
      cb.id = (SELECT MIN(x.id) FROM character_blogs x JOIN tumblr_connections xt ON xt.workspace_id=x.workspace_id AND xt.id=x.tumblr_connection_id
        LEFT JOIN refresh_cursors xr ON xr.workspace_id=x.workspace_id AND xr.character_blog_id=x.id
        WHERE x.workspace_id=cb.workspace_id AND x.character_id=cb.character_id AND xt.status='active' AND (xr.next_retry_at IS NULL OR xr.next_retry_at <= ?)) AS leadsCharacter,
      ROW_NUMBER() OVER (PARTITION BY cb.workspace_id ORDER BY COALESCE(rc.last_attempt_at, ''), cb.id) AS rn,
      COUNT(*) OVER () AS totalDue
    FROM character_blogs cb
    JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
    JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
    LEFT JOIN refresh_cursors rc ON rc.workspace_id=cb.workspace_id AND rc.character_blog_id=cb.id
    WHERE c.state='active' AND tc.status='active'
      AND (rc.next_retry_at IS NULL OR rc.next_retry_at <= ?)
  ) ORDER BY rn, lastAttempt, id LIMIT ?`).bind(now.toISOString(), now.toISOString(), effectiveLimit).all<RefreshTarget & { totalDue: number }>()
  const selected = candidates.results
  dueTargets = selected[0]?.totalDue ?? 0
  let failed = 0, skipped = 0
  // A starter already refreshed through one target's blog is skipped for later
  // targets of the same character (main blog + sideblogs), so every thread's
  // notes are fetched once per run. Mentions are NOT deduped: each blog has
  // its own notification feed.
  const doneStarterIds = new Set<string>()
  // A blog shared by several muses has one notification feed: read it once per run.
  const feedsRead = new Set<string>()
  // One summary push per workspace per run: collect counts here, send once
  // after the target loop, and count its cost against the budget.
  const summary = new Map<string, { tagCount: number; replyCount: number }>()
  // One getPost per distinct latest reply across the whole run: a reply shared
  // by several branches (same starter root) is fetched once, not per branch.
  const excerptCache = new Map<string, string | null>()
  for (const target of selected) {
    if (budget.remaining() <= FINAL_WRITE_HEADROOM) { skipped++; continue }
    try {
      const client = createTumblrClient({ consumerKey: env.TUMBLR_CONSUMER_KEY, consumerSecret: env.TUMBLR_CONSUMER_SECRET,
        token: await decryptToken(target.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(target.tokenSecretEncrypted, env.TOKEN_ENCRYPTION_KEY),
        budget })
      const ownBlogs = await db.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(target.workspaceId, target.characterId).all<{ blogIdentifier: string }>()
      const ownBlogSet = ownBlogs.results.map(blog => canonicalBlogIdentifier(blog.blogIdentifier))
      // Posts Tumblr says were just reblogged or replied to: those threads are checked first.
      const signals = new Set<string>()
      const feedKey = `${target.connectionId}:${canonicalBlogIdentifier(target.blogIdentifier)}`
      if (!feedsRead.has(feedKey)) try {
        feedsRead.add(feedKey)
        const feed = await client.getNotifications(target.blogIdentifier)
        for (const item of feed) if (item.type.startsWith('reblog') || item.type === 'reply' || item.type === 'conversational_note') {
          if (item.postId) signals.add(item.postId)
          if (item.targetPostId) signals.add(item.targetPostId)
        }
        const mentions = feed.filter(item => ['mention', 'mention_in_post', 'mention_in_reply', 'user_mention', 'note_mention'].includes(item.type))
        // All mention dedupe inserts go out in ONE batch (one subrequest); the
        // summary push (sent once per workspace after the loop) covers them.
        if (mentions.length) {
          const stmts = mentions.map(mention => db.prepare('INSERT INTO activity_notification_deliveries (workspace_id,notification_key,created_at) VALUES (?,?,?) ON CONFLICT(workspace_id,notification_key) DO NOTHING RETURNING notification_key')
            .bind(target.workspaceId, `mention:${target.blogIdentifier}:${mention.id}`, now.toISOString()))
          const results = await db.batch(stmts)
          const created = results.reduce((count, result) => count + (((result.results ?? []) as Array<{ notification_key?: string }>).filter(row => row.notification_key).length), 0)
          if (created) {
            const counts = summary.get(target.workspaceId) ?? { tagCount: 0, replyCount: 0 }
            summary.set(target.workspaceId, { tagCount: counts.tagCount + created, replyCount: counts.replyCount })
          }
        }
      } catch (feedError) {
        if (feedError instanceof TumblrRateLimitedError) throw feedError
        /* Activity notifications are optional; thread refresh must still succeed. */
      }
      // Every active starter's branches in ONE query, stalest branch first so
      // each run reaches different threads.
      const branches = await db.prepare(`SELECT b.id, b.starter_id AS starterId, b.latest_post_id AS latestPostId, b.status, b.status_manual_override_at AS statusManualOverrideAt,
          b.last_refresh_at AS lastRefreshAt,
          p.blog_identifier AS partnerBlogIdentifier
        FROM reply_branches b LEFT JOIN partners p ON p.workspace_id=b.workspace_id AND p.id=b.partner_id
        JOIN starters s ON s.workspace_id=b.workspace_id AND s.id=b.starter_id
        WHERE b.workspace_id=? AND b.archived_at IS NULL AND s.archived=0 AND s.source='tumblr'
        ORDER BY b.last_refresh_at IS NULL DESC, b.last_refresh_at ASC, b.id ASC`).bind(target.workspaceId).all<BranchRow>()
      const starterRows = await db.prepare('SELECT id, root_post_id AS rootPostId, root_blog_id AS rootBlogId FROM starters WHERE workspace_id=? AND archived=0 AND character_id=?').bind(target.workspaceId, target.characterId).all<StarterRow>()
      const branchesByStarter = new Map<string, BranchRow[]>()
      for (const branch of branches.results) {
        const list = branchesByStarter.get(branch.starterId) ?? []
        list.push(branch)
        branchesByStarter.set(branch.starterId, list)
      }
      // Threads with a fresh reblog/reply signal first, then stalest branch first (NULLs first), so
      // each run reaches different threads. A character's threads are refreshed only through its
      // first blog (main blog + sideblogs share them), so a 3-blog character costs the same as a
      // 1-blog one; its other blogs still read their own notification feeds.
      // ponytail: signals only steer the blog whose feed was read in this target; sideblog signals
      // wait for the stalest-first sweep. Store signals per character if that delay ever matters.
      const signalled = (row: StarterRow & { branches: BranchRow[] }) => signals.has(row.rootPostId) || row.branches.some(branch => branch.latestPostId !== null && signals.has(branch.latestPostId)) ? 0 : 1
      const starters = (target.leadsCharacter ? starterRows.results : [])
        .filter(row => branchesByStarter.has(row.id))
        .map(row => ({ ...row, branches: branchesByStarter.get(row.id)! }))
        .sort((a, b) => {
          const aStale = a.branches[0].lastRefreshAt ? Date.parse(a.branches[0].lastRefreshAt) : 0
          const bStale = b.branches[0].lastRefreshAt ? Date.parse(b.branches[0].lastRefreshAt) : 0
          return signalled(a) - signalled(b) || aStale - bStale
        })
      // All writes for this target go out in ONE batch (one subrequest).
      const writes: D1PreparedStatement[] = []
      let starterAborted = false
      for (const starter of starters) {
        if (doneStarterIds.has(starter.id)) continue
        if (budget.remaining() <= FINAL_WRITE_HEADROOM) { starterAborted = true; break }
        const root = canonicalBlogIdentifier(starter.rootBlogId)
        // One notes call per starter root post, shared by every branch of that
        // starter; skipped when the budget is spent.
        let activities: Awaited<ReturnType<typeof client.getThreadActivity>> = []
        try {
          activities = await client.getThreadActivity(root, starter.rootPostId)
        } catch (starterErr) {
          if (starterErr instanceof TumblrRateLimitedError) {
            // Tumblr answered 429: an app-wide limit, not this blog's fault.
            // Stop the whole run, keep the work already done, and do not count
            // it as a failure for the blog.
            rateLimited = true
            retryAfterSecs = starterErr.retryAfterSecs
            starterAborted = true
            break
          }
          // A rejected token is the blog's problem, not one thread's: hand it to the
          // blog-level catch so the blog backs off instead of retrying every run.
          if (starterErr instanceof Error && /\((401|403)\)/.test(starterErr.message)) throw starterErr
          // Budget exhaustion inside the starter loop is a clean partial stop:
          // no refresh_error, and the next run resumes at this starter.
          if (starterErr instanceof Error && starterErr.message === 'Subrequest budget exhausted') { starterAborted = true; break }
          // A single starter's notes call failing should not sink the whole
          // target: stamp the branches and move on to the next starter.
          failed++
          const message = starterErr instanceof Error ? starterErr.message.slice(0, 500) : 'Tumblr refresh failed'
          for (const branch of starter.branches) {
            writes.push(db.prepare('UPDATE reply_branches SET refresh_error=?,last_refresh_at=? WHERE workspace_id=? AND id=?')
              .bind(message, now.toISOString(), target.workspaceId, branch.id))
          }
          continue
        }
        // Branches the apply callback updates get a full write (status,
        // latest_post_id, last_refresh_at, etc.); branches with no new
        // activity only get a last_refresh_at stamp so the stalest-first
        // ordering reaches each thread across runs.
        const updatedBranchIds = new Set<string>()
        await refreshStarterBranches({ workspaceId: target.workspaceId, starterId: starter.id, rootBlogIdentifier: root, ownBlogIdentifiers: ownBlogSet, branches: starter.branches, activities, now }, async (branch, activity, status) => {
          updatedBranchIds.add(branch.id)
          // A manual "Your turn"/"Their turn" choice holds only until Tumblr
          // activity newer than it arrives; then the detected status wins and
          // the override clears. Otherwise the manual status is preserved.
          const overrideWins = branch.statusManualOverrideAt !== null && !(activity.timestamp > branch.statusManualOverrideAt)
          const finalStatus = overrideWins ? branch.status : status
          const clearedOverride = branch.statusManualOverrideAt !== null && !overrideWins
          // The notes carry no text; fetch the reply post once per distinct post
          // (cached) to read its preview. A failure never sinks the refresh — the
          // branch still records the new reply, just without an excerpt.
          let excerpt = excerptCache.get(activity.postId)
          if (excerpt === undefined && budget.remaining() > FINAL_WRITE_HEADROOM + 1) { // ponytail: never spend the final-write headroom on an excerpt
            try { excerpt = replyExcerpt((await client.getPost(activity.blogIdentifier, activity.postId)).preview) } catch (e) { if (e instanceof TumblrRateLimitedError) throw e; excerpt = null }
            excerptCache.set(activity.postId, excerpt)
          }
          writes.push(
            db.prepare(`UPDATE reply_branches SET latest_post_id=?,last_poster=?,last_activity_at=?,latest_reply_excerpt=?,last_refresh_at=?,refresh_error=NULL,status=?,status_manual_override_at=? WHERE workspace_id=? AND id=?`)
              .bind(activity.postId, activity.blogIdentifier, activity.timestamp, excerpt ?? null, now.toISOString(), finalStatus, clearedOverride ? null : branch.statusManualOverrideAt, target.workspaceId, branch.id),
            db.prepare(`INSERT INTO activities (id,workspace_id,starter_id,reply_branch_id,type,actor,source,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
              .bind(crypto.randomUUID(), target.workspaceId, starter.id, branch.id, 'tumblr_reply_detected', activity.blogIdentifier, 'tumblr', JSON.stringify({ postId: activity.postId }), now.toISOString()),
          )
          // Count instead of pushing per branch; one summary push per
          // workspace goes out after the target loop.
          if (finalStatus === 'your_turn' && branch.status !== 'your_turn') {
            const counts = summary.get(target.workspaceId) ?? { tagCount: 0, replyCount: 0 }
            summary.set(target.workspaceId, { tagCount: counts.tagCount, replyCount: counts.replyCount + 1 })
          }
        })
        // Stamp only the branches the apply callback did not already update.
        for (const branch of starter.branches) {
          if (updatedBranchIds.has(branch.id)) continue
          writes.push(db.prepare('UPDATE reply_branches SET last_refresh_at=?,refresh_error=NULL WHERE workspace_id=? AND id=?')
            .bind(now.toISOString(), target.workspaceId, branch.id))
        }
        doneStarterIds.add(starter.id)
      }
      const cursor = db.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_successful_refresh_at,last_error,failure_count,next_retry_at)
        VALUES (?,?,?,?,NULL,0,NULL) ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_successful_refresh_at=excluded.last_successful_refresh_at,last_error=NULL,failure_count=0,next_retry_at=NULL`)
        .bind(target.workspaceId, target.id, now.toISOString(), now.toISOString())
      // Stamp the blog even when it has no threads, so it rotates behind its siblings. A blog cut
      // short by the budget stays unstamped and goes first next run.
      if (!starterAborted) writes.push(cursor)
      if (writes.length) await db.batch(writes)
      refreshed++
      if (starterAborted) break
    } catch (error) {
      if (error instanceof TumblrRateLimitedError) {
        rateLimited = true
        retryAfterSecs = error.retryAfterSecs
        break
      }
      // Budget exhaustion is a clean partial stop: keep the work already done,
      // write no refresh_error, and leave the rest for the next run.
      if (error instanceof Error && error.message === 'Subrequest budget exhausted') {
        skipped++
        break
      }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Tumblr refresh failed'
      // Item 3c: one structured log line per failing connection — id + status only,
      // never post text, drafts, or tokens.
      console.warn('refresh failure', { connectionId: target.connectionId, status: redact(message).slice(0, 300) })
      // Exponential backoff: 30 min x 2^(failure_count-1), capped at 24 h. The
      // failing blog is skipped until then; it is not a budget skip and does
      // not affect other blogs or workspaces.
      const previous = (await db.prepare('SELECT failure_count AS count FROM refresh_cursors WHERE workspace_id=? AND character_blog_id=?').bind(target.workspaceId, target.id).first<{ count: number | null }>())?.count ?? 0
      const backoffMs = Math.min(30 * 60_000 * 2 ** previous, 24 * 3_600_000)
      const nextRetryAt = new Date(now.getTime() + backoffMs).toISOString()
      const cursor = db.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_error,failure_count,next_retry_at) VALUES (?,?,?,?,1,?)
        ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error,failure_count=refresh_cursors.failure_count+1,next_retry_at=excluded.next_retry_at`).bind(target.workspaceId, target.id, now.toISOString(), message, nextRetryAt)
      const branches = db.prepare(`UPDATE reply_branches SET refresh_error=?,last_refresh_at=? WHERE workspace_id=? AND starter_id IN (SELECT id FROM starters WHERE workspace_id=? AND archived=0 AND character_id=(SELECT character_id FROM character_blogs WHERE workspace_id=? AND id=?))`)
        .bind(message, now.toISOString(), target.workspaceId, target.workspaceId, target.workspaceId, target.id)
      await db.batch([cursor, branches])
      failed++
    }
  }
  // One summary push per workspace with anything to report. The push cost is
  // 1 D1 read (subscription list) + 1 fetch per subscription, all counted
  // against the budget before the fetches go out. sendWorkspacePush uses
  // env.DB directly (not the counting wrapper) so the D1 read is accounted
  // for here, not double-counted.
  for (const [workspaceId, counts] of summary) {
    if (rateLimited) break
    if (budget.remaining() <= FINAL_WRITE_HEADROOM) break
    const subCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE workspace_id=?').bind(workspaceId).first<{ n: number }>())?.n ?? 0
    budget.consumeD1()
    if (budget.remaining() - 1 < subCount) break // keep 1 for the scheduler batch
    for (let i = 0; i < subCount; i++) budget.consume()
    const body = [counts.replyCount ? `${counts.replyCount} replies waiting` : null, counts.tagCount ? `${counts.tagCount} new tags` : null].filter(Boolean).join(', ')
    await sendWorkspacePush(env, workspaceId, { title: 'RP Thread Buddy', body, url: '/#inbox' })
  }
  const used = budget.used()
  return { selected: selected.length, refreshed, failed, skipped, fetchesUsed: used.fetches, d1Used: used.d1, rateLimited }
  } finally {
    try {
      // Record the run's rate_limited flag, and — when a 429 was hit — hold the
      // next run off until the Retry-After window (if Tumblr sent one).
      if (rateLimited && retryAfterSecs !== null) {
        {
          const until = new Date(now.getTime() + retryAfterSecs * 1000).toISOString()
          await env.DB.prepare('INSERT INTO refresh_scheduler_state (id,rate_limited_until,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET rate_limited_until=excluded.rate_limited_until,updated_at=excluded.updated_at').bind(until, now.toISOString()).run()
        }
      }
      await env.DB.prepare('UPDATE refresh_runs SET finished_at=?,due=?,refreshed=?,rate_limited=? WHERE id=?')
        .bind(now.toISOString(), dueTargets, refreshed, rateLimited ? 1 : 0, runId).run()
    } catch { /* best effort */ }
  }
}
