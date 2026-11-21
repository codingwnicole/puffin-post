import { describe, expect, it } from 'vitest'
import { tumblrTime } from '../../src/tumblr/client'

describe('tumblrTime', () => {
  it('reads unix seconds and never throws on bad input', () => {
    expect(tumblrTime(1763208000)).toBe('2025-11-15T12:00:00.000Z')
    expect(tumblrTime('1763208000')).toBe('2025-11-15T12:00:00.000Z')
    expect(tumblrTime('2026-11-14T12:00:00Z')).toBe('2026-11-14T12:00:00.000Z')
    expect(tumblrTime(undefined)).toBe('1970-01-01T00:00:00.000Z')
    expect(tumblrTime('garbage')).toBe('1970-01-01T00:00:00.000Z')
    expect(tumblrTime(Number.NaN)).toBe('1970-01-01T00:00:00.000Z')
  })
})
