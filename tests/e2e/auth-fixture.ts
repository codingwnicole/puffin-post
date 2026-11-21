import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

const APP = 'http://localhost:5173'

function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  const line = readFileSync(resolve(process.cwd(), '.dev.vars'), 'utf8').split(/\r?\n/).find(value => value.startsWith('SESSION_SECRET='))
  const value = line?.slice('SESSION_SECRET='.length).trim()
  if (!value) throw new Error('E2E local setup needs SESSION_SECRET in .dev.vars')
  return value
}

function sqlString(value: string): string { return `'${value.replaceAll("'", "''")}'` }

export async function createSignedInUser(page: Page, options: { email?: string; password?: string } = {}) {
  const email = options.email ?? `e2e-${randomUUID()}@example.test`
  const password = options.password ?? 'correct horse battery'
  const userId = randomUUID(), workspaceId = randomUUID(), token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const signature = createHmac('sha256', sessionSecret()).update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
  const sql = [
    `INSERT INTO users (id,email,display_name,auth_identity) VALUES (${sqlString(userId)},${sqlString(email)},${sqlString(email.split('@')[0])},${sqlString(`email:${email}`)})`,
    `INSERT INTO workspaces (id,name,owner_user_id) VALUES (${sqlString(workspaceId)},${sqlString('E2E workspace')},${sqlString(userId)})`,
    `INSERT INTO memberships (workspace_id,user_id,role) VALUES (${sqlString(workspaceId)},${sqlString(userId)},'owner')`,
    `INSERT INTO sessions (id_hash,user_id,workspace_id,expires_at) VALUES (${sqlString(tokenHash)},${sqlString(userId)},${sqlString(workspaceId)},${sqlString(expiresAt)})`,
  ].join(';')
  const wrangler = resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler')
  // SQL goes in a file: passing it inline through cmd.exe (needed for .cmd on Windows) mangled the quotes.
  // Parallel workers share one local SQLite file, so a locked database is retried.
  mkdirSync(resolve(process.cwd(), 'test-results'), { recursive: true })
  const sqlFile = `test-results/seed-${userId}.sql`
  writeFileSync(resolve(process.cwd(), sqlFile), sql + ';')
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync(wrangler, ['d1', 'execute', 'threadums-local', '--local', '--yes', '--file', sqlFile], { cwd: process.cwd(), stdio: 'pipe', shell: process.platform === 'win32' })
        break
      } catch (error) {
        if (attempt >= 4) throw new Error(`E2E user seed failed: ${String((error as { stderr?: Buffer }).stderr ?? error)}`)
        await new Promise(done => setTimeout(done, 500 * attempt))
      }
    }
  } finally { rmSync(resolve(process.cwd(), sqlFile), { force: true }) }
  // Current Chromium rejects a Secure cookie set against an http:// URL; localhost still sends it over http.
  await page.context().addCookies([{ name: '__Host-threadums_session', value: `${token}.${signature}`, url: APP.replace('http:', 'https:'), secure: true, httpOnly: true, sameSite: 'Lax' }])
  const passwordResponse = await page.request.post(`${APP}/api/auth/password`, { data: { password }, headers: { origin: APP } })
  if (passwordResponse.status() !== 204) throw new Error(`E2E user setup could not set a password (${passwordResponse.status()})`)
  return { email, password, userId, workspaceId }
}
