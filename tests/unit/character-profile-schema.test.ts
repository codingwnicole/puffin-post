import { expect, it } from 'vitest'
import { characterProfileSchema, emptyCharacterProfile, parsePublicCharacterProfile } from '../../src/shared/character-profile'

it('defaults all supplementary public modules to opt-in', () => {
  const profile = emptyCharacterProfile()
  expect(profile.introduction.enabled).toBe(false)
  expect(profile.quizzes.enabled).toBe(false)
  expect(profile.social.enabled).toBe(false)
})

it('keeps public section order complete and rejects duplicate modules', () => {
  const order = ['biography', 'introduction', 'basics', 'personality', 'relationships', 'quotes', 'songs', 'trivia', 'social', 'quizzes', 'quicklinks']
  expect(characterProfileSchema.parse({ sectionOrder: order }).sectionOrder).toEqual(order)
  expect(characterProfileSchema.safeParse({ sectionOrder: [...order.slice(1), 'introduction'] }).success).toBe(false)
})

it('rejects unsafe fictional profile fields and oversized content', () => {
  expect(characterProfileSchema.safeParse({ social: { enabled: true, username: 'name<script>', accentColor: '#abcdef' } }).success).toBe(false)
  expect(characterProfileSchema.safeParse({ biography: { enabled: true, text: 'a'.repeat(6001) } }).success).toBe(false)
})

it('drops malformed or unrecognized published JSON to an empty profile', () => {
  expect(parsePublicCharacterProfile('{broken').biography.enabled).toBe(false)
  expect(parsePublicCharacterProfile(JSON.stringify({ privateNotes: 'do not publish' })).biography.enabled).toBe(false)
})
