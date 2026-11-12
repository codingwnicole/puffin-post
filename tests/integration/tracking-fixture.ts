import { readdir, readFile } from 'node:fs/promises'
import { getPlatformProxy } from 'wrangler'
import { Hono } from 'hono'
import { startSession } from '../../src/auth/sessions'
import { createApp, type Env } from '../../src/worker'

export async function trackingFixture() {
  const platform = await getPlatformProxy<Env>({ persist: false })
  const env = { ...platform.env, APP_ORIGIN: 'https://threadums.test', SESSION_SECRET: 'test-only-session-secret-with-32-characters' }
  for (const file of (await readdir('src/db/migrations')).sort()) {
    const sql = await readFile(`src/db/migrations/${file}`, 'utf8')
    await env.DB.batch(sql.split(';').filter(s => s.trim()).map(s => env.DB.prepare(s)))
  }
  const cookies: Record<string, string> = {}
  for (const id of ['a', 'b']) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id,email,display_name,auth_identity) VALUES (?,?,?,?)').bind(id, `${id}@example.com`, id, id),
      env.DB.prepare('INSERT INTO workspaces (id,name,owner_user_id) VALUES (?,?,?)').bind(id,id,id),
      env.DB.prepare("INSERT INTO memberships (workspace_id,user_id,role) VALUES (?,?,'owner')").bind(id,id),
      env.DB.prepare('INSERT INTO characters (id,workspace_id,name) VALUES (?,?,?)').bind(`character-${id}`,id,`Character ${id}`),
      env.DB.prepare('INSERT INTO partners (id,workspace_id,blog_identifier,display_label) VALUES (?,?,?,?)').bind(`partner-${id}`,id,`${id}.tumblr.com`,`Partner ${id}`),
    ])
    const login = new Hono<{ Bindings: Env }>()
    login.get('/', async c => { await startSession(c,id,id); return c.text('ok') })
    cookies[id] = (await login.request('/', {}, env)).headers.get('set-cookie')!.split(';')[0]
  }
  return {
    env, dispose: platform.dispose,
    async request(path: string, method = 'GET', body?: unknown, tenant = 'a') {
      return createApp(env).request(path, { method, headers: { origin: env.APP_ORIGIN,
        cookie: cookies[tenant] ?? '', 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env)
    },
  }
}

export const starterInput = { characterId: 'character-a', title: 'Open starter', rootPostId: '12345', rootBlogId: 'a.tumblr.com', description: 'Shared scene' }
