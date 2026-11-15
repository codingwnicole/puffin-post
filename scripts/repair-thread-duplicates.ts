import type { D1Database } from '@cloudflare/workers-types'

/**
 * B10 — dry-run (default) / apply repair for duplicate thread starters.
 *
 * Background: migration 0024 creates the partial unique index
 *   starters_workspace_thread_identity ON starters (workspace_id, thread_root_blog_id, thread_root_id)
 *   WHERE thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL
 * which cannot be created on live D1 while duplicate rows exist. This script
 * (run via vitest — the project has no ts-node/tsx runner) finds those
 * groups and either reports a merge plan (dry-run, the default) or applies it
 * (--apply semantics, enabled here via the env flag REPAIR_THREAD_DUPLICATES=apply).
 *
 * Merge rules (match runtime find-or-create + upsertReplyBranch semantics):
 *  - survivor per group = oldest row (created_at, then id);
 *  - reply_branches: re-point starter_id; on (workspace_id, starter_id, partner_id)
 *    conflict keep the row with the most recent last_activity_at (ties: duplicate kept);
 *  - starter_tags: re-point, INSERT OR IGNORE on the (workspace, starter, tag) PK;
 *  - activities: re-point starter_id; re-point reply_branch_id for lost branches;
 *  - reply_drafts: re-point converted_starter_id / converted_branch_id;
 *  - then delete the duplicate starter rows.
 */

interface PlanRow {
  id: string;
  workspace_id: string;
  thread_root_blog_id: string;
  thread_root_id: string;
  created_at: string;
  title: string;
}

export interface RepairPlan {
  workspaceId: string;
  rootBlogId: string;
  rootId: string;
  survivorId: string;
  duplicateIds: string[];
  moves: { branchId: string; duplicateId: string; reason: string }[];
  skippedBranches: { branchId: string; duplicateId: string; conflictPartner: string | null }[];
  tagMoves: number;
  activityMoves: number;
  draftMoves: number;
}

export async function buildRepairPlan(db: D1Database): Promise<RepairPlan[]> {
  const res = await db
    .prepare(
      `SELECT id, workspace_id, thread_root_blog_id, thread_root_id, created_at, title
       FROM starters
       WHERE thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL
       ORDER BY workspace_id, thread_root_blog_id, thread_root_id, created_at, id`
    )
    .all<PlanRow>()
  const rows = res.results

  const byGroup = new Map<string, PlanRow[]>()
  for (const row of rows) {
    const key = `${row.workspace_id}|${row.thread_root_blog_id}|${row.thread_root_id}`
    const list = byGroup.get(key) ?? []
    list.push(row)
    byGroup.set(key, list)
  }

  const plans: RepairPlan[] = []
  for (const groupRows of byGroup.values()) {
    if (groupRows.length < 2) continue
    const survivor = groupRows[0]!
    const duplicates = groupRows.slice(1)
    const plan: RepairPlan = {
      workspaceId: survivor.workspace_id,
      rootBlogId: survivor.thread_root_blog_id,
      rootId: survivor.thread_root_id,
      survivorId: survivor.id,
      duplicateIds: duplicates.map((d) => d.id),
      moves: [],
      skippedBranches: [],
      tagMoves: 0,
      activityMoves: 0,
      draftMoves: 0,
    }

    const survBranchRes = await db
      .prepare(`SELECT id, partner_id FROM reply_branches WHERE workspace_id = ? AND starter_id = ?`)
      .bind(plan.workspaceId, survivor.id)
      .all<{ id: string; partner_id: string | null }>()
    const survivorBranches = survBranchRes.results

    for (const dup of duplicates) {
      const dupBranchRes = await db
        .prepare(
          `SELECT id, partner_id, last_activity_at FROM reply_branches
           WHERE workspace_id = ? AND starter_id = ?
           ORDER BY COALESCE(last_activity_at, '') DESC, id`
        )
        .bind(plan.workspaceId, dup.id)
        .all<{ id: string; partner_id: string | null; last_activity_at: string | null }>()

      for (const b of dupBranchRes.results) {
        const existing =
          b.partner_id === null ? null : survivorBranches.find((s) => s.partner_id === b.partner_id)
        if (existing) {
          plan.skippedBranches.push({ branchId: b.id, duplicateId: dup.id, conflictPartner: b.partner_id })
        } else {
          plan.moves.push({
            branchId: b.id,
            duplicateId: dup.id,
            reason: b.partner_id ? `partner ${b.partner_id}` : 'no partner',
          })
          if (b.partner_id !== null) {
            survivorBranches.push({ id: b.id, partner_id: b.partner_id })
          }
        }
      }
      plan.tagMoves += (
        await db
          .prepare(`SELECT COUNT(*) AS n FROM starter_tags WHERE workspace_id = ? AND starter_id = ?`)
          .bind(plan.workspaceId, dup.id)
          .first<{ n: number }>()
      )!.n
      plan.activityMoves += (
        await db
          .prepare(`SELECT COUNT(*) AS n FROM activities WHERE workspace_id = ? AND starter_id = ?`)
          .bind(plan.workspaceId, dup.id)
          .first<{ n: number }>()
      )!.n
      plan.draftMoves += (
        await db
          .prepare(`SELECT COUNT(*) AS n FROM reply_drafts WHERE workspace_id = ? AND converted_starter_id = ?`)
          .bind(plan.workspaceId, dup.id)
          .first<{ n: number }>()
      )!.n
    }
    plans.push(plan)
  }
  return plans
}

export async function applyPlan(db: D1Database, plan: RepairPlan): Promise<void> {
  // D1 batch() runs all statements in a single atomic transaction.
  //
  // FK constraints in play:
  //   reply_branches.(ws, starter_id) → starters.(ws, id)
  //   activities.(ws, starter_id) → starters.(ws, id)
  //   activities.(ws, starter_id, reply_branch_id) → reply_branches.(ws, starter_id, id)
  //   starter_tags.(ws, starter_id) → starters.(ws, id)
  //   reply_drafts.(ws, converted_starter_id, converted_branch_id) → reply_branches.(ws, starter_id, id)
  //
  // reply_drafts CHECK constraint:
  //   (state='converted' AND converted_starter_id IS NOT NULL AND converted_branch_id IS NOT NULL)
  //   OR (state<>'converted' AND converted_starter_id IS NULL AND converted_branch_id IS NULL)
  // So a converted draft's branch can't be NULLed — a 2-step or 3-step
  // approach is impossible. SQLite checks FKs against the FINAL row state
  // after an UPDATE (proven by the NULL-branch trick for activities), so
  // a single statement setting both starter AND branch works.
  //
  // Per-duplicate order:
  //   1. Re-point activities (NULL trick per branch):
  //      NULL reply_branch_id → FK check skipped. Then set starter_id
  //      → survivor AND reply_branch_id → target (kept or self).
  //      Branches are still on the duplicate, so (dup, branch) is valid. ✓
  //   2. Re-point remaining activities (NULL branch, just starter change). ✓
  //   3. Move branches: starter_id → survivor. Activities no longer
  //      reference (dup, b) — re-pointed in Step 1. ✓
  //   4. Re-point reply_drafts: single UPDATE (branch + starter).
  //      Branches are now on the survivor, so (survivor, newBranch) is
  //      valid in reply_branches. ✓
  //   5. INSERT OR IGNORE starter_tags for survivor (idempotent). ✓
  //   6. DELETE starter_tags for duplicate. ✓
  //   7. DELETE lost reply_branches (activities + drafts already re-pointed). ✓
  //   8. DELETE duplicate starter row (all children re-pointed or gone). ✓

  // --- Build branch mapping (queries, not part of batch) ---
  const keepBranch = new Map<string, string>() // lostId → survivorId
  const survivorBranches: { id: string; partner_id: string | null }[] = []

  const survBranchRes = await db
    .prepare(`SELECT id, partner_id FROM reply_branches WHERE workspace_id = ? AND starter_id = ?`)
    .bind(plan.workspaceId, plan.survivorId)
    .all<{ id: string; partner_id: string | null }>()
  for (const sb of survBranchRes.results) {
    survivorBranches.push(sb)
  }

  for (const dupId of plan.duplicateIds) {
    const dupBranchRes = await db
      .prepare(
        `SELECT id, partner_id FROM reply_branches
         WHERE workspace_id = ? AND starter_id = ?
         ORDER BY COALESCE(last_activity_at, '') DESC, id`
      )
      .bind(plan.workspaceId, dupId)
      .all<{ id: string; partner_id: string | null }>()

    for (const b of dupBranchRes.results) {
      const existing =
        b.partner_id === null ? null : survivorBranches.find((s) => s.partner_id === b.partner_id)
      if (existing) {
        keepBranch.set(b.id, existing.id)
      } else if (b.partner_id !== null) {
        survivorBranches.push({ id: b.id, partner_id: b.partner_id })
      }
    }
  }

  // Per-duplicate lost-branch map: keeps the branch-delete step in Step 6
  // scoped to the CURRENT duplicate instead of the whole-plan map, so a
  // later duplicate's branches are never deleted when the plan has more
  // than one duplicate.
  const lostByDup = new Map<string, string[]>()
  for (const dupId of plan.duplicateIds) {
    const dupBranchRes = await db
      .prepare(`SELECT id FROM reply_branches WHERE workspace_id = ? AND starter_id = ?`)
      .bind(plan.workspaceId, dupId)
      .all<{ id: string }>()
    lostByDup.set(dupId, dupBranchRes.results.map((b) => b.id).filter((id) => keepBranch.has(id)))
  }

  // --- Build all batch statements in FK-safe order ---
  const statements: D1PreparedStatement[] = []

  for (const dupId of plan.duplicateIds) {
    const dupBranchRes = await db
      .prepare(`SELECT id FROM reply_branches WHERE workspace_id = ? AND starter_id = ?`)
      .bind(plan.workspaceId, dupId)
      .all<{ id: string }>()
    const dupBranchIds = dupBranchRes.results.map((b) => b.id)

    // Step 1: Re-point activities per branch (NULL trick, interleaved
    // with branch moves for moved branches).
    //
    // For LOST branches (keepBranch has an entry):
    //   1a: NULL reply_branch_id (FK check skipped — NULL FK value). ✓
    //   1b: Set starter_id → survivor AND reply_branch_id → kept branch.
    //       The kept branch is on the SURVIVOR, so (survivor, keptBranch)
    //       is valid in reply_branches. SQLite checks the final row state. ✓
    //
    // For MOVED branches (no keepBranch entry):
    //   1a: NULL reply_branch_id (FK check skipped). ✓
    //   1b: Move the branch: starter_id → survivor.
    //       No activities reference (dup, b) anymore — re-pointed in 1a. ✓
    //   1c: Set starter_id → survivor AND reply_branch_id → b.
    //       b is now on the survivor, so (survivor, b) is valid. ✓
    for (const b of dupBranchIds) {
      const actRes = await db
        .prepare(
          `SELECT id FROM activities WHERE workspace_id = ? AND starter_id = ? AND reply_branch_id = ?`,
        )
        .bind(plan.workspaceId, dupId, b)
        .all<{ id: string }>()
      const actIds = actRes.results.map((a) => a.id)

      if (actIds.length > 0) {
        const ph = actIds.map(() => '?').join(', ')
        // 1a: NULL out reply_branch_id (FK check skipped).
        statements.push(
          db.prepare(
            `UPDATE activities SET reply_branch_id = NULL
             WHERE workspace_id = ? AND starter_id = ? AND id IN (${ph})`,
          ).bind(plan.workspaceId, dupId, ...actIds),
        )

        if (keepBranch.has(b)) {
          // Lost branch: set starter + branch in one statement.
          // The kept branch is already on the survivor. ✓
          const target = keepBranch.get(b)!
          statements.push(
            db.prepare(
              `UPDATE activities SET starter_id = ?, reply_branch_id = ?
               WHERE workspace_id = ? AND starter_id = ? AND id IN (${ph})`,
            ).bind(plan.survivorId, target, plan.workspaceId, dupId, ...actIds),
          )
        } else {
          // Moved branch: move the branch first, then set starter + branch.
          // 1b: Move branch to survivor (no activities reference (dup, b)).
          statements.push(
            db.prepare(`UPDATE reply_branches SET starter_id = ? WHERE workspace_id = ? AND id = ?`).bind(
              plan.survivorId,
              plan.workspaceId,
              b,
            ),
          )
          // 1c: Set starter + branch (b is now on the survivor).
          statements.push(
            db.prepare(
              `UPDATE activities SET starter_id = ?, reply_branch_id = ?
               WHERE workspace_id = ? AND starter_id = ? AND id IN (${ph})`,
            ).bind(plan.survivorId, b, plan.workspaceId, dupId, ...actIds),
          )
        }
      } else {
        // No activities on this branch — still need to move it if it's
        // a moved branch.
        if (!keepBranch.has(b)) {
          statements.push(
            db.prepare(`UPDATE reply_branches SET starter_id = ? WHERE workspace_id = ? AND id = ?`).bind(
              plan.survivorId,
              plan.workspaceId,
              b,
            ),
          )
        }
      }
    }
    // 1d: Re-point remaining activities (branch NULL or not on any
    // duplicate branch, just starter change).
    statements.push(
      db.prepare(
        `UPDATE activities SET starter_id = ?
         WHERE workspace_id = ? AND starter_id = ?
           AND (reply_branch_id IS NULL OR reply_branch_id NOT IN (${dupBranchIds.map(() => '?').join(', ')}))`,
      ).bind(plan.survivorId, plan.workspaceId, dupId, ...dupBranchIds),
    )

    // Step 3: Re-point reply_drafts (single UPDATE: branch + starter).
    // Branches are now on the survivor (Step 2), so (survivor, newBranch)
    // is valid in reply_branches. SQLite checks the final row state. ✓
    const draftRes = await db
      .prepare(
        `SELECT id, converted_branch_id FROM reply_drafts
         WHERE workspace_id = ? AND converted_starter_id = ?`,
      )
      .bind(plan.workspaceId, dupId)
      .all<{ id: string; converted_branch_id: string | null }>()
    for (const d of draftRes.results) {
      const newBranch = d.converted_branch_id
        ? (keepBranch.get(d.converted_branch_id) ?? d.converted_branch_id)
        : null
      if (d.converted_branch_id) {
        statements.push(
          db.prepare(
            `UPDATE reply_drafts SET converted_starter_id = ?, converted_branch_id = ?
             WHERE workspace_id = ? AND id = ?`,
          ).bind(plan.survivorId, newBranch, plan.workspaceId, d.id),
        )
      } else {
        statements.push(
          db.prepare(
            `UPDATE reply_drafts SET converted_starter_id = ? WHERE workspace_id = ? AND id = ?`,
          ).bind(plan.survivorId, plan.workspaceId, d.id),
        )
      }
    }

    // Step 4: INSERT OR IGNORE starter_tags for survivor (idempotent).
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO starter_tags (workspace_id, starter_id, tag_id)
         SELECT workspace_id, ?, tag_id FROM starter_tags WHERE workspace_id = ? AND starter_id = ?`,
      ).bind(plan.survivorId, plan.workspaceId, dupId),
    )

    // Step 5: DELETE starter_tags for duplicate.
    statements.push(
      db.prepare(`DELETE FROM starter_tags WHERE workspace_id = ? AND starter_id = ?`).bind(
        plan.workspaceId,
        dupId,
      ),
    )

    // Step 6: DELETE lost reply_branches for THIS duplicate only (activities
    // + drafts already re-pointed). Scoped per-duplicate so a later
    // duplicate's branches survive the batch.
    const lostBranchIds = lostByDup.get(dupId) ?? []
    if (lostBranchIds.length > 0) {
      const placeholders = lostBranchIds.map(() => '?').join(', ')
      statements.push(
        db.prepare(`DELETE FROM reply_branches WHERE workspace_id = ? AND id IN (${placeholders})`).bind(
          plan.workspaceId,
          ...lostBranchIds,
        ),
      )
    }

    // Step 7: DELETE duplicate starter row (all children re-pointed or gone).
    statements.push(
      db.prepare(`DELETE FROM starters WHERE workspace_id = ? AND id = ?`).bind(
        plan.workspaceId,
        dupId,
      ),
    )
  }

  await db.batch(statements)
}

export interface RepairResult {
  mode: 'dry-run' | 'apply'
  plans: RepairPlan[]
}

export async function repairThreadDuplicates(
  db: D1Database,
  opts: { apply?: boolean } = {}
): Promise<RepairResult> {
  const plans = await buildRepairPlan(db)
  const mode = opts.apply ? 'apply' : 'dry-run'
  if (opts.apply) {
    for (const plan of plans) {
      await applyPlan(db, plan)
    }
  }
  return { mode, plans }
}
