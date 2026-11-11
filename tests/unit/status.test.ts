import { expect, it } from 'vitest'
import { REPLY_STATUSES } from '../../src/shared/domain'

it('exports the four valid reply statuses', () => {
  expect(REPLY_STATUSES).toEqual(['your_turn', 'their_turn', 'queued', 'archived'])
})
