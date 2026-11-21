import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async () => { fixture = await trackingFixture() }, 30_000)
afterEach(async () => { await fixture.dispose() })

describe('B04: idempotent blog assignment', () => {
  it('assigns the same character to the same blog twice: 200 then 200, exactly one row', async () => {
    const first = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com', characterTag: 'tag-one' })
    expect(first.status).toBe(200)
    const second = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com', characterTag: 'tag-one' })
    expect(second.status).toBe(200)
    const body = await second.json() as { id: string; characterId: string; blogIdentifier: string; characterTag: string | null }
    expect(body.id).toBe((await first.json() as { id: string }).id)
    expect(body.characterId).toBe('character-a')
    expect(body.blogIdentifier).toBe('a.tumblr.com')
    expect(body.characterTag).toBe('tag-one')
    const rows = await fixture.env.DB.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind('a', 'character-a', 'a.tumblr.com').all<{ id: string }>()
    expect(rows.results.length).toBe(1)
  })

  it('409s a second character on the same blog with no tags', async () => {
    const created = await fixture.request('/api/characters', 'POST', { name: 'Character d' })
    expect(created.status).toBe(201)
    const other = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: (await created.json() as { id: string }).id, blogIdentifier: 'a.tumblr.com' })
    expect(other.status).toBe(409)
    const body = await other.json() as { error: string }
    expect(body.error).toMatch(/different character tag/i)
  })

  it('lets two characters share a blog when their tags differ', async () => {
    const created = await fixture.request('/api/characters', 'POST', { name: 'Character c' })
    expect(created.status).toBe(201)
    const third = (await created.json()) as { id: string }
    const first = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com', characterTag: 'aaa' })
    expect(first.status).toBe(200)
    const second = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: third.id, blogIdentifier: 'a.tumblr.com', characterTag: 'bbb' })
    expect(second.status).toBe(201)
  })

  it('re-saves with a changed tag by updating the row', async () => {
    const resaved = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com', characterTag: 'renamed' })
    expect(resaved.status).toBe(200)
    const body = await resaved.json() as { characterTag: string | null }
    expect(body.characterTag).toBe('renamed')
    const row = await fixture.env.DB.prepare('SELECT character_tag FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind('a', 'character-a', 'a.tumblr.com').first<{ character_tag: string | null }>()
    expect(row?.character_tag).toBe('renamed')
    const count = await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind('a', 'character-a', 'a.tumblr.com').first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('reclaims a blog from an archived duplicate without touching its history', async () => {
    await fixture.env.DB.prepare("INSERT INTO characters (id,workspace_id,name,state) VALUES (?,?,?,?)").bind('character-archived', 'a', 'Retired character', 'archived').run()
    // Free the blog first: two whole-blog rules on one blog violate character_blogs_one_whole_blog_rule.
    await fixture.env.DB.prepare("DELETE FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?").bind('a', 'character-a', 'a.tumblr.com').run()
    await fixture.env.DB.prepare("INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)").bind('blog-archived', 'a', 'character-archived', 'connection-a', 'a.tumblr.com', 'a').run()

    const reassigned = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com' })
    expect(reassigned.status).toBe(201)
    expect((await fixture.env.DB.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=?').bind('a', 'character-archived').all()).results).toEqual([])
    expect((await fixture.env.DB.prepare('SELECT id FROM character_blogs WHERE workspace_id=? AND character_id=? AND blog_identifier=?').bind('a', 'character-a', 'a.tumblr.com').all()).results).toHaveLength(1)
  })

  it('409s a re-save that would give a character the same tag as another character on the shared blog', async () => {
    await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: 'character-a', blogIdentifier: 'a.tumblr.com', characterTag: 'aaa' })
    const other = (await (await fixture.request('/api/characters', 'POST', { name: 'Character e' })).json()) as { id: string }
    expect((await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: other.id, blogIdentifier: 'a.tumblr.com', characterTag: 'bbb' })).status).toBe(201)
    const clash = await fixture.request('/api/connections/connection-a/blogs', 'POST', { characterId: other.id, blogIdentifier: 'a.tumblr.com', characterTag: 'aaa' })
    expect(clash.status).toBe(409)
  })
})
