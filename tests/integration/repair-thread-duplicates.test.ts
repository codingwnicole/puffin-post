import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { Env } from '../../src/worker'
import { buildRepairPlan, applyPlan, repairThreadDuplicates } from '../../scripts/repair-thread-duplicates'
import { sqlStatements } from './sql-statements'

/**
 * B10 — dry-run (default) / apply repair for duplicate thread starters.
 *
 * Tests the real script exports (buildRepairPlan, applyPlan, repairThreadDuplicates)
 * against a real D1 database via the wrangler platform proxy.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MIGRATIONS_DIR = path.join(ROOT, 'src/db/migrations')

async function migrate(db: Env['DB']): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const stmts = sqlStatements(sql)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // The test seeds two starters sharing a thread root (the duplicate
      // scenario under repair).  The 0024 partial unique index would
      // reject the second INSERT, so skip it in the test schema.
      .filter((s) => !s.startsWith('CREATE UNIQUE INDEX starters_workspace_thread_identity'))
    if (stmts.length > 0) {
      await db.batch(stmts.map((s) => db.prepare(s)))
    }
  }
}

async function seed(db: Env['DB']): Promise<void> {
  const now = new Date().toISOString()
  await db.batch([
    db.prepare(`INSERT INTO users (id, email, display_name, auth_identity) VALUES ('u1', 'a@b.c', 'A', 'u1')`),
    db.prepare(`INSERT INTO workspaces (id, name, owner_user_id) VALUES ('w1', 'ws', 'u1')`),
    db.prepare(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ('w1', 'u1', 'owner')`),
    db.prepare(`INSERT INTO partners (id, workspace_id, blog_identifier, display_label) VALUES ('p1', 'w1', 'p1.tumblr.com', 'P1'), ('p2', 'w1', 'p2.tumblr.com', 'P2')`),
    db.prepare(`INSERT INTO characters (id, workspace_id, name) VALUES ('c1', 'w1', 'Test Char')`),
    db.prepare(`INSERT INTO tags (id, workspace_id, normalized_label, display_label) VALUES ('t1', 'w1', 'tag1', 'Tag 1'), ('t2', 'w1', 'tag2', 'Tag 2')`),
  ])
  // s1 must be inserted before s2: the 0024 unique index on
  // (workspace_id, thread_root_blog_id, thread_root_id) forbids both
  // sharing a thread root in a single batch.
  await db.prepare(`INSERT INTO starters (id, workspace_id, character_id, title, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id, created_at)
    VALUES ('s1', 'w1', 'c1', 'Original thread', 'post1', 'blogA', '123', 'blogA', ?)`).bind('2026-01-01T00:00:00.000Z').run()
  await db.batch([
    db.prepare(`INSERT INTO starters (id, workspace_id, character_id, title, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id, created_at)
      VALUES ('s2', 'w1', 'c1', 'Duplicate (older title)', 'post1', 'blogA', '123', 'blogA', ?)`).bind('2026-01-02T00:00:00.000Z'),
    db.prepare(`INSERT INTO starters (id, workspace_id, character_id, title, root_post_id, root_blog_id, thread_root_id, thread_root_blog_id, created_at)
      VALUES ('s3', 'w1', 'c1', 'Unrelated thread', 'post9', 'blogB', '999', 'blogB', ?)`).bind('2026-01-01T00:00:00.000Z'),
    db.prepare(`INSERT INTO starters (id, workspace_id, character_id, title, root_post_id, root_blog_id, created_at)
      VALUES ('s4', 'w1', 'c1', 'No thread root', 'post4', 'blogD', ?)`).bind(now),
  ])
  await db.batch([
    db.prepare(`INSERT INTO reply_branches (id, workspace_id, starter_id, partner_id, last_activity_at) VALUES
      ('b1', 'w1', 's1', 'p1', '2026-01-01T00:00:00.000Z'),
      ('b2', 'w1', 's2', 'p1', '2026-01-02T00:00:00.000Z'),
      ('b3', 'w1', 's2', 'p2', '2026-01-03T00:00:00.000Z')`),
  ])
  await db.batch([
    db.prepare(`INSERT INTO starter_tags (workspace_id, starter_id, tag_id) VALUES
      ('w1', 's1', 't1'), ('w1', 's2', 't1'), ('w1', 's2', 't2')`),
  ])
  await db.batch([
    db.prepare(`INSERT INTO activities (id, workspace_id, starter_id, reply_branch_id, type, actor, source, created_at) VALUES
      ('a1', 'w1', 's2', 'b2', 'reply', 'u1', 'manual', ?),
      ('a2', 'w1', 's2', 'b3', 'reply', 'u1', 'manual', ?),
      ('a3', 'w1', 's1', 'b1', 'reply', 'u1', 'manual', ?)`).bind(now, now, now),
  ])
  await db.batch([
    db.prepare(`INSERT INTO reply_drafts (id, workspace_id, character_id, partner_id, title, converted_starter_id, converted_branch_id, state, created_at, updated_at)
      VALUES ('d1', 'w1', 'c1', 'p1', 'Converted draft', 's2', 'b2', 'converted', ?, ?)`).bind(now, now),
  ])
}

describe('B10 thread duplicate repair (dry-run + apply)', () => {
  let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>
  let db: Env['DB']
  let dispose: () => Promise<void>

  beforeAll(async () => {
    platform = await getPlatformProxy<Env>({ persist: false })
    db = platform.env.DB
    dispose = platform.dispose
    await migrate(db)
    await seed(db)
  })

  afterAll(async () => {
    await dispose()
  })

  it('dry-run (default) reports the plan and changes nothing', async () => {
    const result = await repairThreadDuplicates(db, { apply: false })
    expect(result.mode).toBe('dry-run')
    expect(result.plans).toHaveLength(1)
    const plan = result.plans[0]!
    expect(plan.survivorId).toBe('s1')
    expect(plan.duplicateIds).toEqual(['s2'])
    expect(plan.moves).toEqual([{ branchId: 'b3', duplicateId: 's2', reason: 'partner p2' }])
    expect(plan.skippedBranches).toEqual([{ branchId: 'b2', duplicateId: 's2', conflictPartner: 'p1' }])
    expect(plan.tagMoves).toBe(2)
    expect(plan.activityMoves).toBe(2)
    expect(plan.draftMoves).toBe(1)

    // Nothing changed: still 4 starters, 3 branches, s2 still exists.
    const starters = await db.prepare(`SELECT COUNT(*) AS n FROM starters`).first<{ n: number }>()
    expect(starters!.n).toBe(4)
    const branches = await db.prepare(`SELECT COUNT(*) AS n FROM reply_branches`).first<{ n: number }>()
    expect(branches!.n).toBe(3)
    const s2 = await db.prepare(`SELECT id FROM starters WHERE id = 's2'`).first<{ id: string }>()
    expect(s2).toBeTruthy()
  })

  it('apply mode merges duplicates and leaves one row per thread root', async () => {
    const plans = await buildRepairPlan(db)
    expect(plans).toHaveLength(1)
    for (const plan of plans) {
      await applyPlan(db, plan)
    }

    // s2 is gone; s1 and s3 remain.
    const s2 = await db.prepare(`SELECT id FROM starters WHERE id = 's2'`).first<{ id: string }>()
    expect(s2).toBeNull()
    const starters = await db.prepare(`SELECT COUNT(*) AS n FROM starters WHERE workspace_id = 'w1'`).first<{ n: number }>()
    expect(starters!.n).toBe(3)

    // Branches: b1 (s1, p1) and b3 (moved to s1, p2); b2 (conflict) deleted.
    const branches = await db.prepare(
      `SELECT id, partner_id, starter_id FROM reply_branches WHERE workspace_id = 'w1' ORDER BY id`
    ).all<{ id: string; partner_id: string; starter_id: string }>()
    expect(branches.results).toEqual([
      { id: 'b1', partner_id: 'p1', starter_id: 's1' },
      { id: 'b3', partner_id: 'p2', starter_id: 's1' },
    ])

    // Tags: s1 now has t1 (kept, INSERT OR IGNORE) and t2 (moved from s2).
    const tags = await db
      .prepare(
        `SELECT tag_id FROM starter_tags WHERE workspace_id = 'w1' AND starter_id = 's1' ORDER BY tag_id`
      )
      .all<{ tag_id: string }>()
    expect(tags.results).toEqual([{ tag_id: 't1' }, { tag_id: 't2' }])

    // Activities: a1 re-pointed from b2 to b1 (conflict branch), a2 to b3, a3 unchanged.
    const activities = await db
      .prepare(
        `SELECT id, starter_id, reply_branch_id FROM activities WHERE workspace_id = 'w1' ORDER BY id`
      )
      .all<{ id: string; starter_id: string; reply_branch_id: string }>()
    expect(activities.results).toEqual([
      { id: 'a1', starter_id: 's1', reply_branch_id: 'b1' },
      { id: 'a2', starter_id: 's1', reply_branch_id: 'b3' },
      { id: 'a3', starter_id: 's1', reply_branch_id: 'b1' },
    ])

    // Draft d1: converted_starter_id re-pointed to s1, converted_branch_id re-pointed b2 -> b1.
    const draft = await db.prepare(
      `SELECT converted_starter_id, converted_branch_id FROM reply_drafts WHERE workspace_id = 'w1' AND id = 'd1'`
    ).first<{ converted_starter_id: string; converted_branch_id: string }>()
    expect(draft).toEqual({ converted_starter_id: 's1', converted_branch_id: 'b1' })
  })

  it('buildRepairPlan is idempotent after apply (no duplicate groups remain)', async () => {
    const plans = await buildRepairPlan(db)
    expect(plans).toHaveLength(0)
  })
})
