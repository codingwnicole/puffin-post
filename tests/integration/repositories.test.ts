import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Env } from '../../src/worker'
import { requireMembership } from '../../src/db/repositories/workspaces'
import { createStarter } from '../../src/db/repositories/starters'
import { createReplyBranch, listInboxBranches } from '../../src/db/repositories/branches'

describe('tenant-safe repositories against local D1', () => {
  let db: Env['DB']
  let dispose: () => Promise<void>

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    db = platform.env.DB
    dispose = platform.dispose
    const migration = await readFile('src/db/migrations/0001_initial.sql', 'utf8')
    await db.batch(migration.split(';').filter((sql) => sql.trim()).map((sql) => db.prepare(sql)))
    const refreshMigration = await readFile('src/db/migrations/0005_refresh.sql', 'utf8')
    await db.batch(refreshMigration.split(';').filter((sql) => sql.trim()).map((sql) => db.prepare(sql)))
    for (const tenant of ['a', 'b']) {
      await db.prepare('INSERT INTO users (id, email, display_name, auth_identity) VALUES (?, ?, ?, ?)')
        .bind(`member-${tenant}`, `${tenant}@example.com`, tenant, `identity-${tenant}`).run()
      await db.prepare('INSERT INTO workspaces (id, name, owner_user_id) VALUES (?, ?, ?)')
        .bind(tenant, tenant, `member-${tenant}`).run()
      await db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')")
        .bind(tenant, `member-${tenant}`).run()
      await db.prepare('INSERT INTO characters (id, workspace_id, name) VALUES (?, ?, ?)')
        .bind(`character-${tenant}`, tenant, tenant).run()
      await db.prepare('INSERT INTO partners (id, workspace_id, blog_identifier, display_label) VALUES (?, ?, ?, ?)')
        .bind(`partner-${tenant}`, tenant, `${tenant}.tumblr.com`, tenant).run()
    }
  }, 30_000)

  afterEach(async () => { await dispose?.() })

  async function seedBranch(tenant: string) {
    const starter = await createStarter({ db, userId: `member-${tenant}`, workspaceId: tenant,
      characterId: `character-${tenant}`, title: `Starter ${tenant}`, rootPostId: '123', rootBlogId: `${tenant}.tumblr.com` })
    return createReplyBranch({ db, userId: `member-${tenant}`, workspaceId: tenant,
      starterId: starter.id, partnerId: `partner-${tenant}` })
  }

  it('returns no branches belonging to another workspace', async () => {
    await seedBranch('a')
    await seedBranch('b')
    const rows = await listInboxBranches({ db, workspaceId: 'a', userId: 'member-a' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ workspaceId: 'a', title: 'Starter a', status: 'your_turn' })
  })

  it('requires membership for every public entry point', async () => {
    const branch = await seedBranch('b')
    const scope = { db, workspaceId: 'b', userId: 'member-a' }
    await expect(requireMembership(db, scope.userId, scope.workspaceId)).rejects.toThrow('Workspace access denied')
    await expect(listInboxBranches(scope)).rejects.toThrow('Workspace access denied')
    await expect(createStarter({ ...scope, characterId: 'character-b', title: 'Invalid', rootPostId: '5', rootBlogId: 'b' }))
      .rejects.toThrow('Workspace access denied')
    await expect(createReplyBranch({ ...scope, starterId: branch.starterId })).rejects.toThrow('Workspace access denied')
  })

  it('permits ordinary members and denies access after membership removal', async () => {
    await db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES ('a', 'member-b', 'member')").run()
    expect(await requireMembership(db, 'member-b', 'a')).toMatchObject({ role: 'member', workspaceId: 'a', userId: 'member-b' })
    await seedBranch('a')
    const scope = { db, userId: 'member-b', workspaceId: 'a' }
    expect(await listInboxBranches(scope)).toHaveLength(1)
    await db.prepare("DELETE FROM memberships WHERE workspace_id = 'a' AND user_id = 'member-b'").run()
    await expect(listInboxBranches(scope)).rejects.toThrow('Workspace access denied')
  })

  it('rejects foreign character, starter and partner references even for a member', async () => {
    const scope = { db, workspaceId: 'a', userId: 'member-a' }
    const foreign = await seedBranch('b')
    const own = await seedBranch('a')
    await expect(createStarter({ ...scope, characterId: 'character-b', title: 'Invalid', rootPostId: '5', rootBlogId: 'b' }))
      .rejects.toThrow('Character not found')
    await expect(createReplyBranch({ ...scope, starterId: foreign.starterId })).rejects.toThrow('Starter not found')
    await expect(createReplyBranch({ ...scope, starterId: own.starterId, partnerId: 'partner-b' })).rejects.toThrow('Partner not found')
    expect(await listInboxBranches(scope)).toHaveLength(1)
  })

  it('keeps participant branches separate and filters active/archive lanes', async () => {
    const first = await seedBranch('a')
    const scope = { db, workspaceId: 'a', userId: 'member-a' }
    await createReplyBranch({ ...scope, starterId: first.starterId, status: 'queued', notes: 'Waiting' })
    const archived = await createReplyBranch({ ...scope, starterId: first.starterId, status: 'archived' })
    expect(archived.archivedAt).not.toBeNull()
    expect(await listInboxBranches(scope)).toHaveLength(2)
    expect(await listInboxBranches({ ...scope, status: 'queued' })).toHaveLength(1)
    expect(await listInboxBranches({ ...scope, status: 'archived' })).toHaveLength(1)
  })

  it('enforces tenant links and status invariants in the schema', async () => {
    const branch = await seedBranch('b')
    await expect(db.prepare("INSERT INTO reply_branches (id, workspace_id, starter_id) VALUES ('invalid', 'a', ?)")
      .bind(branch.starterId).run()).rejects.toThrow()
    await expect(db.prepare("UPDATE reply_branches SET status = 'invalid' WHERE id = ?").bind(branch.id).run()).rejects.toThrow()
    await expect(db.prepare("UPDATE reply_branches SET status = 'archived' WHERE id = ?").bind(branch.id).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO starter_tags (workspace_id, starter_id, tag_id) VALUES ('a', ?, 'missing')")
      .bind(branch.starterId).run()).rejects.toThrow()
  })

  it('enforces tenant links for blogs, cursors, tags and activity branches', async () => {
    const own = await seedBranch('a')
    const foreign = await seedBranch('b')
    await db.prepare("INSERT INTO tumblr_connections (id, workspace_id, token_encrypted, token_secret_encrypted) VALUES ('connection-b', 'b', 'ciphertext', 'ciphertext')").run()
    await expect(db.prepare("INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES ('bad-blog', 'a', 'character-a', 'connection-b', 'blog', 'Blog')").run()).rejects.toThrow()
    await db.prepare("INSERT INTO character_blogs (id, workspace_id, character_id, tumblr_connection_id, blog_identifier, display_label) VALUES ('blog-b', 'b', 'character-b', 'connection-b', 'blog', 'Blog')").run()
    await expect(db.prepare("INSERT INTO refresh_cursors (workspace_id, character_blog_id) VALUES ('a', 'blog-b')").run()).rejects.toThrow()
    await db.prepare("INSERT INTO tags (id, workspace_id, normalized_label, display_label) VALUES ('tag-b', 'b', 'tag', 'Tag')").run()
    await expect(db.prepare("INSERT INTO starter_tags (workspace_id, starter_id, tag_id) VALUES ('a', ?, 'tag-b')")
      .bind(own.starterId).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO activities (id, workspace_id, starter_id, reply_branch_id, type, actor, source) VALUES ('invalid', 'a', ?, ?, 'reply', 'system', 'tumblr')")
      .bind(own.starterId, foreign.id).run()).rejects.toThrow()
    const sibling = await createStarter({ db, userId: 'member-a', workspaceId: 'a', characterId: 'character-a',
      title: 'Another starter', rootPostId: '456', rootBlogId: 'a.tumblr.com' })
    await expect(db.prepare("INSERT INTO activities (id, workspace_id, starter_id, reply_branch_id, type, actor, source) VALUES ('wrong-starter', 'a', ?, ?, 'reply', 'system', 'tumblr')")
      .bind(sibling.id, own.id).run()).rejects.toThrow()
  })
})
