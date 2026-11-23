import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sqlStatements } from '../integration/sql-statements'

describe('sqlStatements', () => {
  it('ignores semicolons inside comments', () => {
    expect(sqlStatements("CREATE TABLE t (a);\n-- keep the turn state; rows that only retain 'x'\nUPDATE t SET a = 1;\n"))
      .toEqual(['CREATE TABLE t (a)', 'UPDATE t SET a = 1'])
  })
  it('splits every migration into statements that start with SQL, not comment leftovers', () => {
    for (const file of readdirSync('src/db/migrations')) {
      for (const stmt of sqlStatements(readFileSync(`src/db/migrations/${file}`, 'utf8')))
        expect(stmt, file).toMatch(/^(CREATE|ALTER|UPDATE|INSERT|DELETE|DROP|PRAGMA|WITH|REPLACE)\b/i)
    }
  })
})
