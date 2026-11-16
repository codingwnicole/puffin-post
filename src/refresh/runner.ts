import type { Env } from '../worker'
import { createTumblrClient, type FetchBudget } from '../tumblr/client'
import { decryptToken } from '../tumblr/oauth'
import { canonicalBlogIdentifier } from '../tumblr/normalize'
import { rotateAfter } from './cursor'
import { refreshStarterBranches, type RefreshBranch } from '../tumblr/refresh'
import { sendWorkspacePush } from '../routes/push'

export interface RefreshBatchResult { selected: number; refreshed: number; failed: number; skipped?: number; fetchesUsed?: number }
interface RefreshTarget { id: string; workspaceId: string; characterId: string; blogIdentifier: string; tokenEncrypted: string; tokenSecretEncrypted: string }
interface StarterRow { id: string; rootPostId: string; rootBlogId: string }
interface BranchRow extends RefreshBranch { starterId: string; lastRefreshAt: string | null }

// Cloudflare free plan: 50 subrequests per invocation, counting fetches AND
// D1 calls combined. sendDuePushes shares the invocation, so hold back: 30
// leaves 20 for sendDuePushes' worst case (1 D1 query + 1 fetch per due
// subscription + updates).
const SUBREQUEST_BUDGET = 30
// The target and starter loops stop with this many subrequests still free, so
// the per-target write batch (1) and the scheduler-state batch (1) always fit.
const FINAL_WRITE_HEADROOM = 2

// Counts every outbound fetch and every D1 call (prepare or batch) in the run.
// `d1` and `fetches` are tracked separately so the runner can gate starter notes
// calls on the combined remaining budget without starving D1 reads.
class SubrequestBudget {
  private d1 = 0
  private fetches = 0
  constructor(private readonly cap: number) {}
  remaining(): number { return Math.max(0, this.cap - this.d1 - this.fetches) }
  consumeD1(): void { this.d1 += 1 }
  consumeFetch(): void { this.fetches += 1 }
  consume(): void { this.fetches += 1 }
  usedCount(): number { return this.d1 + this.fetches }
}

// Wraps a D1Database so every D1 operation (run/all/first/batch) consumes one
// subrequest. prepare() is free in D1 — only executing a statement counts.
function countingDB(db: D1Database, budget: SubrequestBudget): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const stmt = db.prepare(sql) as any
    return {
      bind: stmt.bind.bind(stmt),
      run: async (...args: unknown[]) => { budget.consumeD1(); return stmt.run(...args) },
      all: async (...args: unknown[]) => { budget.consumeD1(); return stmt.all(...args) },
      first: async (...args: unknown[]) => { budget.consumeD1(); return stmt.first(...args) },
    } as any
  }
  return { ...db, prepare, batch: (stmts: D1PreparedStatement[]) => { budget.consumeD1(); return db.batch(stmts) } } as unknown as D1Database
}

export async function runRefreshBatch(env: Env, now: Date, limit: number, options: { fetchBudget?: number; targetLimit?: number } = {}): Promise<RefreshBatchResult> {
  const budget = new SubrequestBudget(Math.max(1, options.fetchBudget ?? SUBREQUEST_BUDGET))
  const db = countingDB(env.DB, budget)
  const effectiveLimit = Math.max(1, Math.min(limit, options.targetLimit ?? limit))
  const state = await db.prepare('SELECT last_character_blog_id AS lastCharacterBlogId FROM refresh_scheduler_state WHERE id=1').first<{ lastCharacterBlogId: string | null }>()
  const candidates = await db.prepare(`SELECT cb.id, cb.workspace_id AS workspaceId, cb.character_id AS characterId, cb.blog_identifier AS blogIdentifier,
      tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted
    FROM character_blogs cb JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
    JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
    WHERE c.state='active' AND tc.status='active' ORDER BY cb.id`).all<RefreshTarget>()
  const selected = rotateAfter(candidates.results, state?.lastCharacterBlogId ?? null, effectiveLimit)
  let refreshed = 0, failed = 0, skipped = 0
  // A starter already refreshed through one target's blog is skipped for later
  // targets of the same character (main blog + sideblogs), so every thread's
  // notes are fetched once per run. Mentions are NOT deduped: each blog has
  // its own notification feed.
  const doneStarterIds = new Set<string>()
  // One summary push per workspace per run: collect counts here, send once
  // after the target loop, and count its cost against the budget.
  const summary = new Map<string, { tagCount: number; replyCount: number }>()
  let lastTargetId: string | null = null
  for (const target of selected) {
    if (budget.remaining() <= FINAL_WRITE_HEADROOM) { skipped++; continue }
    try {
      lastTargetId = target.id
      const client = createTumblrClient({ consumerKey: env.TUMBLR_CONSUMER_KEY, consumerSecret: env.TUMBLR_CONSUMER_SECRET,
        token: await decryptToken(target.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(target.tokenSecretEncrypted, env.TOKEN_ENCRYPTION_KEY),
        budget })
      const ownBlogs = await db.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(target.workspaceId, target.characterId).all<{ blogIdentifier: string }>()
      const ownBlogSet = ownBlogs.results.map(blog => canonicalBlogIdentifier(blog.blogIdentifier))
      try {
        const mentions = (await client.getNotifications(target.blogIdentifier)).filter(item => ['mention', 'mention_in_post', 'mention_in_reply', 'user_mention', 'note_mention'].includes(item.type))
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
      } catch { /* Activity notifications are optional; thread refresh must still succeed. */ }
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
      // Order starters by their stalest branch first (NULLs first), so each
      // run refreshes different threads.
      const starters = starterRows.results
        .filter(row => branchesByStarter.has(row.id))
        .map(row => ({ ...row, branches: branchesByStarter.get(row.id)! }))
        .sort((a, b) => {
          const aStale = a.branches[0].lastRefreshAt ? Date.parse(a.branches[0].lastRefreshAt) : 0
          const bStale = b.branches[0].lastRefreshAt ? Date.parse(b.branches[0].lastRefreshAt) : 0
          return aStale - bStale
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
          writes.push(
            db.prepare(`UPDATE reply_branches SET latest_post_id=?,last_poster=?,last_activity_at=?,last_refresh_at=?,refresh_error=NULL,status=?,status_manual_override_at=? WHERE workspace_id=? AND id=?`)
              .bind(activity.postId, activity.blogIdentifier, activity.timestamp, now.toISOString(), finalStatus, clearedOverride ? null : branch.statusManualOverrideAt, target.workspaceId, branch.id),
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
      const cursor = db.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_successful_refresh_at,last_error,failure_count)
        VALUES (?,?,?,?,NULL,0) ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_successful_refresh_at=excluded.last_successful_refresh_at,last_error=NULL,failure_count=0`)
        .bind(target.workspaceId, target.id, now.toISOString(), now.toISOString())
      if (writes.length) { writes.push(cursor); await db.batch(writes) }
      refreshed++
      if (starterAborted) break
    } catch (error) {
      // Budget exhaustion is a clean partial stop: keep the work already done,
      // write no refresh_error, and leave the rest for the next run.
      if (error instanceof Error && error.message === 'Subrequest budget exhausted') {
        skipped++
        break
      }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Tumblr refresh failed'
      const cursor = db.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_error,failure_count) VALUES (?,?,?,?,1)
        ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error,failure_count=refresh_cursors.failure_count+1`).bind(target.workspaceId, target.id, now.toISOString(), message)
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
    if (budget.remaining() <= FINAL_WRITE_HEADROOM) break
    const subCount = (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE workspace_id=?').bind(workspaceId).first<{ n: number }>())?.n ?? 0
    budget.consumeD1()
    if (budget.remaining() - 1 < subCount) break // keep 1 for the scheduler batch
    for (let i = 0; i < subCount; i++) budget.consumeFetch()
    const body = [counts.replyCount ? `${counts.replyCount} replies waiting` : null, counts.tagCount ? `${counts.tagCount} new tags` : null].filter(Boolean).join(', ')
    await sendWorkspacePush(env, workspaceId, { title: 'Puffin Post', body, url: '/#inbox' })
  }
  // Save the last target actually processed, so targets postponed for budget
  // go first next run instead of being rotated past.
  if (lastTargetId) {
    const scheduler = db.prepare(`INSERT INTO refresh_scheduler_state (id,last_character_blog_id,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET last_character_blog_id=excluded.last_character_blog_id,updated_at=excluded.updated_at`).bind(lastTargetId, now.toISOString())
    await db.batch([scheduler])
  }
  return { selected: selected.length, refreshed, failed, skipped, fetchesUsed: budget.usedCount() }
}
