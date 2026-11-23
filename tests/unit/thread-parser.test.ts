import { describe, expect, it } from 'vitest'
import { extractDirectReplyText, extractStablePremise, extractWhere, parsePartnerMuses } from '../../src/tumblr/thread-parser'

describe('deterministic Tumblr thread parsing', () => {
  it.each([
    ['who: Ilyas & Mateo', ['Mateo']],
    ['MUSES: Ilyas and Diana', ['Diana']],
    ['characters — Ilyas / Chayton', ['Chayton']],
    ['cast: Ilyas, Yuna, Chayton', ['Yuna', 'Chayton']],
    ['gifted for: Ilyas x Ana', ['Ana']],
    ['for: Ilyas & Alex', ['Alex']],
    ['starter for: Ilyas and Chayton', ['Chayton']],
    ['with: Ilyas + Ana', ['Ana']],
    ['ft. Ilyas × Maëve', ['Maëve']],
    ['featuring: Ilyas & Zoë', ['Zoë']],
    ['✦ WHO: Ilyas Stone & Mara', ['Mara']],
  ])('parses explicit header %s', (header, expected) => {
    const result = parsePartnerMuses([header], [], 'Ilyas')
    expect(result).toMatchObject({ value: expected, source: 'explicit_header', confidence: 'high', evidence: header.trim() })
  })

  it('does not turn prose, placeholders, or generic tags into muse identities', () => {
    expect(parsePartnerMuses(['he writes for you, and later mentions a muse.'], ['ghost threads', 'tags: threads'], 'Ilyas').value).toBeNull()
    expect(parsePartnerMuses(['for: you'], [], 'Ilyas').value).toBeNull()
    expect(parsePartnerMuses(['with: my muse & your muse'], [], 'Ilyas').value).toBeNull()
    expect(parsePartnerMuses(['featuring: ???'], [], 'Ilyas').value).toBeNull()
  })

  it('uses a conversation tag only when it pairs a known assigned character with a partner', () => {
    expect(parsePartnerMuses([], ['convo: mara & ilyas'], 'Ilyas')).toMatchObject({
      value: ['Mara'], source: 'high_confidence_tag', confidence: 'high', evidence: 'convo: mara & ilyas',
    })
    expect(parsePartnerMuses([], ['convo: mara & zoe'], 'Ilyas').value).toBeNull()
    // Label words inside a name are part of the name, not a label to strip.
    expect(parsePartnerMuses([], ['convo: chayton and character a'], 'Character a').value).toEqual(['Chayton'])
    expect(parsePartnerMuses([], ['ilyas threads', 'mara written'], 'Ilyas').value).toBeNull()
    expect(parsePartnerMuses([], ['convo: ilyas & mara', 'pairing: ilyas & zoe'], 'Ilyas')).toMatchObject({ value: null, source: 'unresolved' })
    expect(parsePartnerMuses(['who: Ilyas & Mara'], ['pairing: ilyas & zoe'], 'Ilyas').value).toEqual(['Mara'])
  })

  it('decodes HTML and preserves Unicode declarations', () => {
    expect(parsePartnerMuses(['<p>✦ Who: Ilyas &amp; Sól</p>'], [], 'Ilyas').value).toEqual(['Sól'])
  })

  it('keeps scene premise tied to root starter setup and excludes metadata', () => {
    const root = '<h2>Where: The old lighthouse</h2><p>Who: Ilyas & Mara</p><p>Rain rattled the glass as Ilyas opened the door.</p><p>They had not spoken since the storm.</p>'
    const laterReply = 'Where: The city hospital\nMara answered the phone.'
    const where = extractWhere([root])
    expect(extractWhere([root, laterReply]).value).toBe(where.value)
    expect(where.value).toBe('The old lighthouse')
    expect(extractStablePremise(root, where.value)).toMatchObject({
      value: 'The old lighthouse. Rain rattled the glass as Ilyas opened the door. They had not spoken since the storm.',
      source: 'root_starter', confidence: 'high',
    })
    expect(extractStablePremise(null).value).toBeNull()
  })

  it('extracts only the selected poster direct contribution, never copied trail text', () => {
    const voices = [
      { blogIdentifier: 'partner.tumblr.com', text: '<p>The newest reply is here.</p><blockquote>Copied earlier reply.</blockquote><p>My response follows it.</p>' },
      { blogIdentifier: 'starter.tumblr.com', text: '<p>Old starter text.</p>' },
    ]
    expect(extractDirectReplyText(voices, 'partner.tumblr.com')).toBe('The newest reply is here.\nMy response follows it.')
    expect(extractDirectReplyText(voices, 'partner.tumblr.com')).not.toContain('Copied earlier reply')
    expect(extractDirectReplyText(voices, 'missing.tumblr.com')).toBeNull()
    expect(extractDirectReplyText([], 'partner.tumblr.com')).toBeNull()
  })
})
