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
// D1 calls combined. sendDuePushes shares the invocation, so hold back.
const SUBREQUEST_BUDGET = 40

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

export async function runRefreshBatch(env: Env, now: Date, limit: number, options: { fetchBudget?: number } = {}): Promise<RefreshBatchResult> {
  const budget = new SubrequestBudget(Math.max(1, options.fetchBudget ?? SUBREQUEST_BUDGET))
  const db = countingDB(env.DB, budget)
  // The client's safeRun consumes the budget before the request goes out, so
  // parallel fetches can no longer all pass remaining() and race the budget.
  const budgetedFetch: typeof fetch = (input, init) => {
    if (budget.remaining() <= 0) throw new Error('Subrequest budget exhausted')
    return fetch(input, init)
  }
  const state = await db.prepare('SELECT last_character_blog_id AS lastCharacterBlogId FROM refresh_scheduler_state WHERE id=1').first<{ lastCharacterBlogId: string | null }>()
  const candidates = await db.prepare(`SELECT cb.id, cb.workspace_id AS workspaceId, cb.character_id AS characterId, cb.blog_identifier AS blogIdentifier,
      tc.token_encrypted AS tokenEncrypted, tc.token_secret_encrypted AS tokenSecretEncrypted
    FROM character_blogs cb JOIN characters c ON c.workspace_id=cb.workspace_id AND c.id=cb.character_id
    JOIN tumblr_connections tc ON tc.workspace_id=cb.workspace_id AND tc.id=cb.tumblr_connection_id
    WHERE c.state='active' AND tc.status='active' ORDER BY cb.id`).all<RefreshTarget>()
  const selected = rotateAfter(candidates.results, state?.lastCharacterBlogId ?? null, limit)
  let refreshed = 0, failed = 0, skipped = 0
  for (const target of selected) {
    if (budget.remaining() <= 0) { skipped++; continue }
    try {
      const client = createTumblrClient({ consumerKey: env.TUMBLR_CONSUMER_KEY, consumerSecret: env.TUMBLR_CONSUMER_SECRET,
        token: await decryptToken(target.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY), tokenSecret: await decryptToken(target.tokenSecretEncrypted, env.TOKEN_ENCRYPTION_KEY),
        fetch: budgetedFetch, budget })
      const ownBlogs = await db.prepare('SELECT blog_identifier AS blogIdentifier FROM character_blogs WHERE workspace_id=? AND character_id=?').bind(target.workspaceId, target.characterId).all<{ blogIdentifier: string }>()
      const ownBlogSet = ownBlogs.results.map(blog => canonicalBlogIdentifier(blog.blogIdentifier))
      try {
        const mentions = (await client.getNotifications(target.blogIdentifier)).filter(item => ['mention', 'mention_in_post', 'mention_in_reply', 'user_mention', 'note_mention'].includes(item.type))
        // All mention dedupe inserts go out in ONE batch (one subrequest); push
        // only for the keys this run actually created.
        if (mentions.length) {
          const stmts = mentions.map(mention => db.prepare('INSERT INTO activity_notification_deliveries (workspace_id,notification_key,created_at) VALUES (?,?,?) ON CONFLICT(workspace_id,notification_key) DO NOTHING RETURNING notification_key')
            .bind(target.workspaceId, `mention:${target.blogIdentifier}:${mention.id}`, now.toISOString()))
          const results = await db.batch(stmts)
          for (let i = 0; i < mentions.length; i++) {
            const mention = mentions[i]
            const result = results[i]
            const isNew = (result.meta?.changes ?? 0) > 0 || ((result.results ?? []) as Array<{ notification_key?: string }>).some(row => row.notification_key)
            if (isNew) await sendWorkspacePush(env, target.workspaceId, { title: 'Puffin Post', body: `${mention.actor === 'anonymous' ? 'Someone' : mention.actor.replace(/\.tumblr\.com$/i, '')} tagged one of your blogs.`, url: '/#activity' })
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
      for (const starter of starters) {
        if (budget.remaining() <= 0) break
        const root = canonicalBlogIdentifier(starter.rootBlogId)
        // One notes call per starter root post, shared by every branch of that
        // starter; skipped when the budget is spent.
        let activities: Awaited<ReturnType<typeof client.getThreadActivity>> = []
        if (budget.remaining() >= 1) {
          try {
            activities = await client.getThreadActivity(root, starter.rootPostId)
          } catch (starterErr) {
            // A single starter's notes call failing should not sink the whole
            // target: stamp the branches and move on to the next starter.
            const message = starterErr instanceof Error ? starterErr.message.slice(0, 500) : 'Tumblr refresh failed'
            for (const branch of starter.branches) {
              writes.push(db.prepare('UPDATE reply_branches SET refresh_error=?,last_refresh_at=? WHERE workspace_id=? AND id=?')
                .bind(message, now.toISOString(), target.workspaceId, branch.id))
            }
            continue
          }
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
          if (finalStatus === 'your_turn' && branch.status !== 'your_turn') await sendWorkspacePush(env, target.workspaceId, { title: 'Puffin Post', body: 'A tracked thread has a new reply waiting on you.', url: '/#inbox' })
        })
        // Stamp only the branches the apply callback did not already update.
        for (const branch of starter.branches) {
          if (updatedBranchIds.has(branch.id)) continue
          writes.push(db.prepare('UPDATE reply_branches SET last_refresh_at=?,refresh_error=NULL WHERE workspace_id=? AND id=?')
            .bind(now.toISOString(), target.workspaceId, branch.id))
        }
      }
      const cursor = db.prepare(`INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_successful_refresh_at,last_error,failure_count)
        VALUES (?,?,?,?,NULL,0) ON CONFLICT(workspace_id,character_blog_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_successful_refresh_at=excluded.last_successful_refresh_at,last_error=NULL,failure_count=0`)
        .bind(target.workspaceId, target.id, now.toISOString(), now.toISOString())
      if (writes.length) writes.push(cursor)
      await db.batch(writes)
      refreshed++
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
  const last = selected.at(-1)
  if (last) {
    const scheduler = db.prepare(`INSERT INTO refresh_scheduler_state (id,last_character_blog_id,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET last_character_blog_id=excluded.last_character_blog_id,updated_at=excluded.updated_at`).bind(last.id, now.toISOString())
    await db.batch([scheduler])
  }
  return { selected: selected.length, refreshed, failed, skipped, fetchesUsed: budget.usedCount() }
}
