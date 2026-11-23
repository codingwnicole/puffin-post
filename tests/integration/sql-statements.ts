// Splits a migration file into statements for D1's batch(). Strips `--` comments first so a
// semicolon in a comment can't cut a statement in half (that produced `near "rows": syntax error`).
// ponytail: no string-literal or trigger awareness; no migration has `;`/`--` in a string or a
// CREATE TRIGGER today. If one ever does, apply migrations with `wrangler d1 migrations apply --local`.
export function sqlStatements(sql: string): string[] {
  return sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)
}
