import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { createReplyDraft, getReplyDraft, updateReplyDraft } from '../../src/db/repositories/reply-drafts'

const connections: DatabaseSync[] = []
afterEach(() => { for (const db of connections.splice(0)) db.close() })

function fixture() {
  const sqlite = new DatabaseSync(':memory:'); connections.push(sqlite)
  for (const file of readdirSync('src/db/migrations').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`src/db/migrations/${file}`, 'utf8'))
  sqlite.exec("INSERT INTO users(id,email,display_name,auth_identity) VALUES('u','u@example.test','u','u'); INSERT INTO workspaces(id,name,owner_user_id) VALUES('w','w','u'); INSERT INTO memberships(workspace_id,user_id,role) VALUES('w','u','owner'); INSERT INTO characters(id,workspace_id,name) VALUES('a','w','A'),('b','w','B')")
  const prepare = (sql: string, values: unknown[] = []): any => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...values as any[]) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values as any[]) }),
    execute: () => ({ results: sqlite.prepare(sql).all(...values as any[]) }),
  })
  const db = { prepare, async batch(statements: any[]) {
    sqlite.exec('BEGIN')
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results }
    catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } } as unknown as D1Database
  return { scope: { db, userId: 'u', workspaceId: 'w' }, sqlite }
}

it('synchronizes assignments for list, legacy, clearing and conflicting updates on real SQLite', async () => {
  const {scope} = fixture()
  const draft = await createReplyDraft(scope, {title:'Draft',notes:'Original'})
  const cases: Array<[Parameters<typeof updateReplyDraft>[2], string | null, string[]]> = [[{characterIds:['b','a']},'b',['a','b']], [{characterId:'a'},'a',['a']], [{characterId:null},null,[]], [{characterId:'b',characterIds:[]},null,[]]]
  for (const [patch, primary, ids] of cases) {
    const result = await updateReplyDraft(scope, draft.id, patch)
    expect(result.characterId).toBe(primary)
    expect(result.characterIds.sort()).toEqual(ids)
  }
})

it('rolls back text and primary assignment if a child write fails', async () => {
  const {scope,sqlite} = fixture()
  const draft = await createReplyDraft(scope,{title:'Draft',notes:'Original'})
  sqlite.exec("CREATE TRIGGER fail_link BEFORE INSERT ON reply_draft_characters BEGIN SELECT RAISE(ABORT,'failure'); END")
  await expect(updateReplyDraft(scope,draft.id,{notes:'Changed',characterIds:['a']})).rejects.toThrow('failure')
  expect(await getReplyDraft(scope,draft.id)).toMatchObject({notes:'Original',characterId:null,characterIds:[]})
})

it('does not change either assignment representation after a draft has been converted', async () => {
  const {scope,sqlite} = fixture()
  const draft = await createReplyDraft(scope,{title:'Draft',notes:'Original',characterId:'a'})
  sqlite.exec("INSERT INTO starters(id,workspace_id,character_id,title,source,root_post_id,root_blog_id,description,created_at) VALUES('s','w','a','Scene','tumblr','100','writer','',CURRENT_TIMESTAMP); INSERT INTO reply_branches(id,workspace_id,starter_id,status,notes,created_at) VALUES('r','w','s','your_turn','',CURRENT_TIMESTAMP)")
  sqlite.prepare("UPDATE reply_drafts SET state='converted',converted_starter_id='s',converted_branch_id='r' WHERE id=?").run(draft.id)
  await expect(updateReplyDraft(scope,draft.id,{notes:'Changed',characterIds:['b']})).rejects.toThrow('Draft is already converted')
  expect(await getReplyDraft(scope,draft.id)).toMatchObject({notes:'Original',characterId:'a',characterIds:['a']})
})
