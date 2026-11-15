import { describe, it, expect } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Env } from '../../src/worker'

async function getDb() {
  const platform = await getPlatformProxy<Env>({ persist: false })
  return { db: platform.env.DB, dispose: () => platform.dispose() }
}

describe('D1 PRAGMA and FK workarounds', () => {
  it('probes PRAGMA and NULL trick', async () => {
    const { db, dispose } = await getDb()
    try {
      // Schema mirrors src/db/migrations exactly (types + UNIQUE back the composite FKs)
      await db.batch([
        db.prepare(`CREATE TABLE workspaces (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`),
        db.prepare(`CREATE TABLE starters (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          title TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (workspace_id, id)
        )`),
        db.prepare(`CREATE TABLE reply_branches (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          starter_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'your_turn' CHECK (status IN ('your_turn', 'their_turn', 'queued', 'archived')),
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (workspace_id, id),
          UNIQUE (workspace_id, starter_id, id),
          CHECK ((status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)),
          FOREIGN KEY (workspace_id, starter_id) REFERENCES starters(workspace_id, id)
        )`),
        db.prepare(`CREATE TABLE activities (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          starter_id TEXT NOT NULL,
          reply_branch_id TEXT,
          type TEXT NOT NULL,
          actor TEXT NOT NULL,
          source TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          FOREIGN KEY (workspace_id, starter_id) REFERENCES starters(workspace_id, id),
          FOREIGN KEY (workspace_id, starter_id, reply_branch_id) REFERENCES reply_branches(workspace_id, starter_id, id)
        )`),
      ])

      const seed = () => db.batch([
        db.prepare(`DELETE FROM activities`),
        db.prepare(`DELETE FROM reply_branches`),
        db.prepare(`DELETE FROM starters`),
        db.prepare(`DELETE FROM workspaces`),
        db.prepare(`INSERT INTO workspaces (id, name, owner_user_id) VALUES ('w1','n','o')`),
        db.prepare(`INSERT INTO starters (id, workspace_id, title) VALUES ('s1','w1','t1'), ('s2','w1','t2')`),
        db.prepare(`INSERT INTO reply_branches (id, workspace_id, starter_id) VALUES ('b1','w1','s2')`),
        db.prepare(`INSERT INTO activities (id, workspace_id, starter_id, reply_branch_id, type, actor, source) VALUES ('a1','w1','s2','b1','x','y','z')`),
      ])

      // Probe 1: PRAGMA as standalone prepare().run()
      await seed()
      let p1 = 'UNKNOWN'
      try {
        await db.prepare(`PRAGMA foreign_keys=OFF`).run()
        p1 = 'OK'
      } catch (e) {
        p1 = `FAILED: ${(e as Error).message.slice(0, 300)}`
      }
      console.log('PROBE 1 (prepare().run() PRAGMA):', p1)

      // Probe 2: PRAGMA inside db.exec()
      await seed()
      let p2 = 'UNKNOWN'
      try {
        await db.exec(`PRAGMA foreign_keys=OFF`)
        p2 = 'OK'
      } catch (e) {
        p2 = `FAILED: ${(e as Error).message.slice(0, 300)}`
      }
      console.log('PROBE 2 (db.exec() PRAGMA):', p2)

      // Probe 3: circular update without pragma (expected to fail)
      await seed()
      let p3 = 'UNKNOWN'
      try {
        await db.batch([
          db.prepare(`UPDATE reply_branches SET starter_id='s1' WHERE id='b1' AND workspace_id='w1'`),
          db.prepare(`UPDATE activities SET starter_id='s1' WHERE id='a1' AND workspace_id='w1'`),
        ])
        p3 = 'OK (unexpected)'
      } catch (e) {
        p3 = `FAILED (expected): ${(e as Error).message.slice(0, 300)}`
      }
      console.log('PROBE 3 (circular update, no pragma):', p3)

      // Probe 4: NULL trick
      await seed()
      let p4 = 'UNKNOWN'
      try {
        await db.batch([
          db.prepare(`UPDATE activities SET reply_branch_id=NULL WHERE workspace_id='w1' AND id='a1'`),
          db.prepare(`UPDATE reply_branches SET starter_id='s1' WHERE id='b1' AND workspace_id='w1'`),
          db.prepare(`UPDATE activities SET starter_id='s1', reply_branch_id='b1' WHERE workspace_id='w1' AND id='a1'`),
        ])
        p4 = 'OK'
      } catch (e) {
        p4 = `FAILED: ${(e as Error).message.slice(0, 300)}`
      }
      console.log('PROBE 4 (NULL trick):', p4)
      if (p4 === 'OK') {
        const rows = await db.prepare(`SELECT id, workspace_id, starter_id, reply_branch_id FROM activities`).all()
        console.log('PROBE 4 activities after:', JSON.stringify(rows))
        const br = await db.prepare(`SELECT id, workspace_id, starter_id FROM reply_branches`).all()
        console.log('PROBE 4 branches after:', JSON.stringify(br))
      }

      expect(true).toBe(true)
    } finally {
      await dispose()
    }
  })
})
