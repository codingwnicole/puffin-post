// Finding the partner's muse when the RP header doesn't name it (shapes from real beta threads).
import { describe, expect, it } from 'vitest'
import { museNameFromProse, museNamesFromTags } from '../../src/tumblr/muse'

const ownIs = (own: string) => (name: string) => name.toLowerCase().split(/\s+/)[0] === own.toLowerCase()

describe('partner muse from prose', () => {
  it('finds the name at the start of a sentence that the user also writes about', () => {
    const partner = "it's ilyas. mateo recognizes him by voice long before he can make out his face. he steps closer, and mateo winces."
    const user = 'as quickly as his relief at seeing mateo washed over him, concern rushes in as mateo goes down.'
    expect(museNameFromProse(partner, user, ownIs('Ilyas'))).toBe('Mateo')
  })
  it('finds a name after dialogue', () => {
    expect(museNameFromProse('"we sail at dawn." diana says, and diana turns away.', 'he watches diana go.', ownIs('Hippolyte'))).toBe('Diana')
  })
  it('never returns the user\'s own muse, pronouns, or a word seen only once', () => {
    expect(museNameFromProse('ilyas argues. he shakes his head. she laughs.', 'ilyas nods.', ownIs('Ilyas'))).toBeNull()
    expect(museNameFromProse('the ship creaks. waves crash.', 'nothing here.', ownIs('Ilyas'))).toBeNull()
  })
})

describe('partner muse from tags', () => {
  it('reads "<name> threads" and "convo: a and b", minus the user\'s muse, only when the name is in the text', () => {
    expect(museNamesFromTags(['chayton threads', 'convo: chayton and ilyas'], 'chayton turned back', ownIs('Ilyas'))).toEqual(['Chayton'])
    expect(museNamesFromTags(['w. ilyas 01', 'nautilus'], 'anything', ownIs('Ilyas'))).toEqual([])
    expect(museNamesFromTags(['ghost threads'], 'no such name in this text', ownIs('Ilyas'))).toEqual([])
  })
})
