import { readdir, readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Env } from '../../src/worker'
import { requireMembership } from '../../src/db/repositories/workspaces'
import { createStarter, getStarter, updateAutomaticStarterFields, updateStarterTitle } from '../../src/db/repositories/starters'
import { createReplyBranch, listInboxBranches, restoreReplyBranch, updateReplyBranch, upsertReplyBranch } from '../../src/db/repositories/branches'
import { sqlStatements } from './sql-statements'

describe('tenant-safe repositories against local D1', () => {
  let db: Env['DB']
  let dispose: () => Promise<void>

  beforeEach(async () => {
    const platform = await getPlatformProxy<Env>({ persist: false })
    db = platform.env.DB
    dispose = platform.dispose
    for (const file of (await readdir('src/db/migrations')).sort()) {
      const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
      await db.batch(sqlStatements(sql).map((s) => db.prepare(s)))
    }
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

  it('restores a reply branch to its previous turn state', async () => {
    const branch = await seedBranch('a')
    const scope = { db, workspaceId: 'a', userId: 'member-a' }
    await updateReplyBranch(scope, branch.id, { status: 'their_turn' })
    await updateReplyBranch(scope, branch.id, { status: 'archived' })

    const archived = await listInboxBranches({ ...scope, archivedOnly: true })
    expect(archived[0]).toMatchObject({ id: branch.id, status: 'archived' })
    const restored = await restoreReplyBranch(scope, branch.id)
    expect(restored).toMatchObject({ id: branch.id, status: 'their_turn', archivedAt: null })
    expect(await restoreReplyBranch(scope, branch.id)).toMatchObject({ id: branch.id, status: 'their_turn', archivedAt: null })
  })

  it('keeps archive state across synchronization and restores the same thread without duplicates', async () => {
    const branch = await seedBranch('a')
    const scope = { db, workspaceId: 'a', userId: 'member-a' }
    const archivedAt = new Date().toISOString()
    await db.prepare('UPDATE starters SET archived=1,archived_at=? WHERE workspace_id=? AND id=?')
      .bind(archivedAt, 'a', branch.starterId).run()

    expect(await listInboxBranches(scope)).toHaveLength(0)
    const refreshed = await upsertReplyBranch({ ...scope, starterId: branch.starterId, partnerId: 'partner-a',
      status: 'their_turn', latestPostId: 'new-reply-1', lastPoster: 'partner-a.tumblr.com',
      lastActivityAt: '2026-11-21T12:00:00.000Z', latestReplyExcerpt: 'A new reply arrived.',
      partnerMuses: ['Mara'], partnerMusesSource: 'explicit_header', partnerMusesConfidence: 'high',
      partnerMusesEvidence: 'who: Ilyas & Mara' })
    expect(refreshed.id).toBe(branch.id)
    expect(await listInboxBranches(scope)).toHaveLength(0)
    expect(await listInboxBranches({ ...scope, archivedOnly: true })).toHaveLength(1)

    await db.prepare('UPDATE starters SET archived=0,archived_at=NULL WHERE workspace_id=? AND id=?')
      .bind('a', branch.starterId).run()
    const restored = await listInboxBranches(scope)
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ id: branch.id, status: 'their_turn', latestPostId: 'new-reply-1', latestReplyExcerpt: 'A new reply arrived.', partnerMuses: ['Mara'] })
  })

  it('protects manually edited titles, premises, partner muses, and recaps from automatic refresh', async () => {
    const scope = { db, workspaceId: 'a', userId: 'member-a' }
    const starter = await createStarter({ ...scope, characterId: 'character-a', title: 'Ilyas × Mara',
      titleSource: 'explicit_header', titleConfidence: 'high', titleEvidence: 'who: Ilyas & Mara',
      description: 'The root setup.', descriptionSource: 'root_starter', descriptionConfidence: 'high',
      premise: 'The root setup.', premiseSource: 'root_starter', premiseConfidence: 'high', rootPostId: 'manual-override', rootBlogId: 'a.tumblr.com' })
    const branch = await createReplyBranch({ ...scope, starterId: starter.id, partnerId: 'partner-a',
      partnerMuses: ['Mara'], partnerMusesSource: 'explicit_header', partnerMusesConfidence: 'high' })
    await updateStarterTitle(scope, starter.id, 'My title', 'My premise')
    await updateReplyBranch(scope, branch.id, { partnerMuses: ['M.'], userRecap: 'Answer the last question next.' })

    const refreshed = await updateAutomaticStarterFields(scope, starter.id, {
      title: 'Ilyas × Renamed', titleSource: 'explicit_header', titleConfidence: 'high',
      description: 'Reparsed setup.', descriptionSource: 'root_starter', descriptionConfidence: 'high',
      premise: 'Reparsed setup.', premiseSource: 'root_starter', premiseConfidence: 'high',
    })
    await upsertReplyBranch({ ...scope, starterId: starter.id, partnerId: 'partner-a', status: 'their_turn',
      latestPostId: 'new-reply-2', latestReplyExcerpt: 'New direct reply.', partnerMuses: ['Different name'],
      partnerMusesSource: 'explicit_header', partnerMusesConfidence: 'high' })
    const refreshedBranch = (await listInboxBranches(scope))[0]
    expect(refreshed).toMatchObject({ title: 'My title', description: 'My premise', premise: 'My premise', titleSource: 'manual', descriptionSource: 'manual', premiseSource: 'manual' })
    expect(refreshedBranch).toMatchObject({ partnerMuses: ['M.'], partnerMusesSource: 'manual', userRecap: 'Answer the last question next.' })
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
