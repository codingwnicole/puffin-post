import { expect, it } from 'vitest'
import { serializeWorkspaceCsv, toFormulaSafeCell } from '../../src/export/csv'

it.each(['=2+2', '+cmd', '-sum', '@value'])('escapes spreadsheet formula %s', value => {
  expect(toFormulaSafeCell(value)).toBe(`'${value}`)
})

it('quotes CSV values and protects formula-leading cells', () => {
  expect(serializeWorkspaceCsv([{ starterTitle: '=danger', character: 'A', rootBlog: 'a.tumblr.com', rootPostId: '1', partner: '', status: 'your_turn', notes: '"note"', lastActivityAt: '' }]))
    .toContain(`"'=danger"`)
})
