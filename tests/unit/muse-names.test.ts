import { describe, expect, it } from 'vitest'
import { museNameFromProse, museNamesFromTags } from '../../src/tumblr/muse'

const ownIs = (own: string) => (name: string) => name.toLocaleLowerCase().split(/\s+/u)[0] === own.toLocaleLowerCase()

describe('legacy muse parsing helpers', () => {
  it('does not infer a muse name from prose, even if it looks plausible', () => {
    const partner = "it's ilyas. mateo recognizes him by voice long before he can make out his face."
    const user = 'as quickly as his relief at seeing mateo washed over him.'
    expect(museNameFromProse(partner, user, ownIs('Ilyas'))).toBeNull()
  })

  it('uses only explicit conversation tags that name both sides of a pair', () => {
    expect(museNamesFromTags(['chayton threads', 'convo: chayton and ilyas'], 'no names needed here', ownIs('Ilyas'))).toEqual(['Chayton'])
    expect(museNamesFromTags(['w. ilyas 01', 'nautilus', 'ghost threads'], 'ghost appears in prose', ownIs('Ilyas'))).toEqual([])
    expect(museNamesFromTags(['convo: chayton & yuna'], 'anything', ownIs('Ilyas'))).toEqual([])
  })
})
