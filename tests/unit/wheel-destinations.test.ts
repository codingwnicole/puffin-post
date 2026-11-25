import { describe, expect, it } from 'vitest'
import { spinLanding } from '../../src/web/lib/spin-wheel'
import { tumblrThreadHref } from '../../src/web/lib/tumblr-links'

describe('wheel geometry', () => {
  it.each([1, 2, 3, 7, 16, 101, 500])('lands every selection under the pointer for %i candidates over repeated spins', count => {
    let rotation = 0
    for (let pass = 0; pass < 3; pass++) for (let index = 0; index < count; index++) {
      const next = spinLanding(rotation, index, count)
      expect(next - rotation).toBeGreaterThanOrEqual(1800)
      const centred = (next + (index + .5) * 360 / count) % 360
      expect(Math.min(centred, 360 - centred)).toBeLessThan(.00001)
      rotation = next
    }
  })
  it('rejects empty wheels and invalid indices', () => {
    expect(() => spinLanding(0, 0, 0)).toThrow(RangeError)
    expect(() => spinLanding(0, 2, 2)).toThrow(RangeError)
  })
})

describe('canonical Tumblr destinations', () => {
  const root = { rootBlogId: 'wren.tumblr.com', rootPostId: '100' }
  it('opens the selected partner branch on the latest poster’s blog', () => {
    expect(tumblrThreadHref({ ...root, latestPostId: '201', lastPoster: 'ash.tumblr.com' })).toBe('https://www.tumblr.com/ash/201')
    expect(tumblrThreadHref({ ...root, latestPostId: '202', lastPoster: 'mira.tumblr.com' })).toBe('https://www.tumblr.com/mira/202')
  })
  it('uses the known root when a latest post has no poster', () => {
    expect(tumblrThreadHref({ ...root, latestPostId: '999', lastPoster: null })).toBe('https://www.tumblr.com/wren/100')
  })
  it('does not invent destinations for manual or incomplete scenes', () => {
    expect(tumblrThreadHref({ ...root, rootBlogId: 'manual' })).toBeNull()
    expect(tumblrThreadHref({ ...root, rootPostId: '' })).toBeNull()
  })
})
