import { afterEach, beforeEach, expect, it } from 'vitest'
import { trackingFixture } from './tracking-fixture'

let fixture: Awaited<ReturnType<typeof trackingFixture>>
beforeEach(async()=>{ fixture=await trackingFixture() },30_000)
afterEach(async()=>{ await fixture.dispose() })

it('uses refresh timestamps rather than lexical error order', async()=>{
  await fixture.env.DB.batch([
    fixture.env.DB.prepare('INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_error) VALUES (?,?,?,?)').bind('a','blog-a','2026-01-01T00:00:00.000Z','zebra old error'),
    fixture.env.DB.prepare('INSERT INTO character_blogs (id,workspace_id,character_id,tumblr_connection_id,blog_identifier,display_label) VALUES (?,?,?,?,?,?)').bind('blog-a-2','a','character-a','connection-a','a2.tumblr.com','a2'),
    fixture.env.DB.prepare('INSERT INTO refresh_cursors (workspace_id,character_blog_id,last_attempt_at,last_successful_refresh_at,last_error) VALUES (?,?,?,?,?)').bind('a','blog-a-2','2026-02-01T00:00:00.000Z','2026-01-31T00:00:00.000Z','alpha latest error'),
  ])
  const body=await (await fixture.request('/api/settings')).json() as any
  expect(body).toMatchObject({latestError:'alpha latest error',latestErrorAt:'2026-02-01T00:00:00.000Z',lastSuccessfulSync:'2026-01-31T00:00:00.000Z'})
})
