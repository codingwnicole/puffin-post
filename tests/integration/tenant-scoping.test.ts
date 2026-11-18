import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Static tenant-scoping audit. Walks the route/refresh/tumblr/auth source, pulls
// every SQL string literal that names a table carrying a workspace_id column,
// and fails if a SELECT/UPDATE/DELETE on such a table does not mention
// workspace_id in the statement — unless the statement is on an explicit,
// one-line-reasoned ALLOWLIST below. The workspace_id table list is derived from
// the migrations at test time (never hardcoded) so a new tenant-scoped table is
// covered automatically.

const ROOT = join(__dirname, '..', '..')
const SCAN_DIRS = ['src/routes', 'src/refresh', 'src/tumblr', 'src/auth']
const MIGRATIONS = join(ROOT, 'src', 'db', 'migrations')

// Derived from CREATE TABLE / ALTER TABLE ... ADD workspace_id in the migrations.
function workspaceTables(): string[] {
  const tables = new Set<string>()
  for (const file of readdirSync(MIGRATIONS)) {
    if (!file.endsWith('.sql')) continue
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\)\s*;/gi)) {
      if (/\bworkspace_id\b/i.test(m[2])) tables.add(m[1])
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+(?:COLUMN\s+)?["`]?workspace_id["`]?/gi)) {
      tables.add(m[1])
    }
  }
  return [...tables].sort()
}

// Extract SQL string literals: template `...`, '...' and "..." (multiline-aware).
function sqlLiterals(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  const re = /(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/gs
  for (const m of source.matchAll(re)) {
    const text = m[1].slice(1, -1)
    // Only a literal that *starts* with a SQL verb is a real statement; this
    // filters out quote spans that accidentally straddle code (e.g. a `'` that
    // closes one string and the next `'` opens the apostrophe of a comment).
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(text)) continue
    out.push({ text, line: source.slice(0, m.index!).split('\n').length })
  }
  return out
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

// Statements that touch a workspace-scoped table but are deliberately not
// scoped by workspace_id, each with a one-line reason. Keep this minimal — fix
// real gaps in the code instead of allowlisting them.
const ALLOWLIST: { file: string; sql: string; reason: string }[] = [
  { file: 'src/routes/auth.ts', sql: 'SELECT COUNT(*) AS n FROM magic_links WHERE email = ?', reason: 'magic-link rate limit is keyed by email, not workspace' },
  { file: 'src/routes/settings.ts', sql: 'DELETE FROM sessions WHERE user_id=?', reason: 'sign-out revokes all sessions of the authed user by user_id' },
  { file: 'src/routes/settings.ts', sql: 'DELETE FROM magic_links WHERE email=?', reason: 'account deletion clears pending magic links by email' },
  { file: 'src/routes/tumblr.ts', sql: 'SELECT * FROM tumblr_oauth_states WHERE state_hash=?', reason: 'ephemeral OAuth state token, not workspace data' },
  { file: 'src/routes/tumblr.ts', sql: 'UPDATE tumblr_oauth_states SET consumed_at=? WHERE state_hash=?', reason: 'ephemeral OAuth state consumption by state hash' },
  { file: 'src/auth/invites.ts', sql: 'SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id', reason: 'invite eligibility checks whether the email is an owner, cross-workspace by design' },
  { file: 'src/auth/magic-links.ts', sql: 'DELETE FROM magic_links WHERE token_hash = ?', reason: 'magic link consumed by its one-time token hash' },
  { file: 'src/refresh/runner.ts', sql: 'SELECT cb.id, cb.workspace_id AS workspaceId', reason: 'cron refresh selects due blogs across all tenants; each row is workspace-scoped downstream' },
]

describe('tenant scoping (static audit)', () => {
  it('derives a non-empty workspace-scoped table list from migrations', () => {
    const tables = workspaceTables()
    expect(tables.length).toBeGreaterThan(0)
    expect(tables).toContain('starters')
    expect(tables).toContain('characters')
    expect(tables).toContain('tumblr_connections')
  })

  it('every SELECT/UPDATE/DELETE on a workspace-scoped table names workspace_id', () => {
    const tables = workspaceTables()
    const tableAlt = tables.join('|')
    const tableRe = new RegExp(`\\b(?:${tableAlt})\\b`, 'i')
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const base = join(ROOT, dir)
      if (!statSync(base).isDirectory()) continue
      for (const file of walk(base)) {
        const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
        const source = readFileSync(file, 'utf8')
        for (const { text, line } of sqlLiterals(source)) {
          if (!tableRe.test(text)) continue
          if (/\bworkspace_id\b/i.test(text)) continue
          const kind = (text.match(/\b(SELECT|INSERT|UPDATE|DELETE)\b/i)?.[0] ?? '?').toUpperCase()
          const allow = ALLOWLIST.some(a => a.file === rel && text.includes(a.sql))
          if (!allow) violations.push(`${rel}:${line} [${kind}] ${text.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('allowlist entries are real: each quoted SQL exists in its named file', () => {
    const missing: string[] = []
    for (const entry of ALLOWLIST) {
      const source = readFileSync(join(ROOT, entry.file), 'utf8')
      if (!source.includes(entry.sql)) missing.push(`${entry.file}: ${entry.sql.slice(0, 60)}`)
    }
    expect(missing).toEqual([])
  })
})
