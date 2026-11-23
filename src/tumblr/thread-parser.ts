export type ParseConfidence = 'high' | 'medium' | 'low' | 'none'
export type FieldSource = 'explicit_header' | 'structured_metadata' | 'confirmed_character_assignment' | 'high_confidence_tag' | 'blog_fallback' | 'root_starter' | 'manual' | 'legacy' | 'unresolved'
export type ParsedField<T> = { value: T | null; source: FieldSource; confidence: ParseConfidence; evidence: string | null }

const unresolved = <T>(): ParsedField<T> => ({ value: null, source: 'unresolved', confidence: 'none', evidence: null })
const plain = (value: string) => value
  .replace(/<\s*(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/giu, ' ')
  .replace(/<\s*blockquote\b[^>]*>[\s\S]*?<\/\s*blockquote\s*>/giu, ' ')
  .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/giu, ' ')
  .replace(/<\s*br\s*\/?\s*>|<\/(?:p|div|li|blockquote|h[1-6])\s*>/giu, '\n')
  .replace(/<[^>]+>/gu, ' ')
  .replace(/&nbsp;|&#160;/giu, ' ')
  .replace(/&amp;/giu, '&').replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
  .replace(/&#(\d+);/gu, (match, n: string) => decodeCodePoint(match, Number(n)))
  .replace(/&#x([\da-f]+);/giu, (match, n: string) => decodeCodePoint(match, parseInt(n, 16)))
  .replace(/[\u200B-\u200D\uFEFF]/gu, '')

function decodeCodePoint(original: string, codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : original
}

const key = (value: string) => plain(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const reserved = new Set(['you', 'your', 'your muse', 'your character', 'your oc', 'your partner', 'me', 'my', 'my muse', 'my character', 'our', 'us', 'the reader', 'the user', 'anyone', 'someone', 'partner', 'writing partner', 'muse', 'tbd'])

function splitNames(value: string): string[] {
  return plain(value).replace(/@[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\([^)]*\)/gu, ' ').replace(/[\[\]]/gu, ' ')
    // Label words only lead a value ("muses: …"); stripping them anywhere broke names like "Character A".
    .replace(/^\s*(?:muses?|characters?|cast)\b/iu, ' ')
    .replace(/\b(?:ft\.?|featuring|with)\b/giu, ' ')
    .split(/\s*(?:&|×|\+|\/|,|;|\band\b|\bx\b)\s*/iu)
    .map(name => name.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '').replace(/\s+/gu, ' ').trim())
    .filter(name => name.length >= 2 && name.length <= 60 && /^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,4}$/u.test(name) && !reserved.has(key(name)))
}

function displayTagName(name: string): string {
  if (name !== name.toLocaleLowerCase()) return name
  return name.replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase())
}

function headerValue(line: string): { value: string; label: string } | null {
  const cleanLine = line.replace(/^[\p{P}\p{S}\s]+/u, '')
  const colon = /^\s*(who|muses?|characters?|cast|gifted\s+for|for|with)\s*(?::|—|–|-)\s*(.{1,180})\s*$/iu.exec(cleanLine)
  if (colon) return { value: colon[2], label: colon[1].toLocaleLowerCase() }
  const prefix = /^\s*(ft\.?|featuring)\s*(?::|—|–|-)?\s*(.{1,180})\s*$/iu.exec(cleanLine)
  if (prefix) return { value: prefix[2], label: prefix[1].toLocaleLowerCase() }
  const starter = /^\s*(?:(?:closed|open|gifted|private)\s+)?starter\s+(?:for|to)\s*(?::|—|–|-)?\s*(.{1,180})\s*$/iu.exec(cleanLine)
  if (starter) return { value: starter[1], label: 'starter for' }
  const gifted = /^\s*gifted\s+for\s*(?::|—|–|-)?\s*(.{1,180})\s*$/iu.exec(cleanLine)
  return gifted ? { value: gifted[1], label: 'gifted for' } : null
}

function pairValue(line: string): string | null {
  const cleanLine = line.replace(/^[\p{P}\p{S}\s]+/u, '')
  const pair = /^\s*([\p{L}][\p{L}\p{M}''.-]*(?:\s+[\p{L}][\p{L}\p{M}''.-]*){0,3})\s*(?:&|×|\bx\b)\s*([\p{L}][\p{L}\p{M}''.-]*(?:\s+[\p{L}][\p{L}\p{M}''.-]*){0,3})\s*[.!?]?\s*$/iu.exec(cleanLine)
  return pair ? `${pair[1]} & ${pair[2]}` : null
}

function isOwnMuse(candidate: string, assignedName: string): boolean {
  const candidateKey = key(candidate), ownKey = key(assignedName)
  // A matching given name is ambiguous when the assignment has a fuller name;
  // suppress it and leave the partner unresolved instead of choosing wrong.
  return Boolean(candidateKey && ownKey && (candidateKey === ownKey || candidateKey.split(' ')[0] === ownKey.split(' ')[0]))
}

/** Only explicit RP header lines can identify a muse. Incidental prose is never treated as a name. */
export function parsePartnerMuses(texts: string[], tags: string[], assignedCharacterName: string): ParsedField<string[]> {
  for (const text of texts) {
    for (const line of plain(text).split(/\r?\n/u).slice(0, 30)) {
      const declaration = headerValue(line)
      const value = declaration?.value ?? pairValue(line)
      if (!value) continue
      const names = splitNames(value).filter(name => !isOwnMuse(name, assignedCharacterName))
      if (names.length) return { value: [...new Set(names)], source: 'explicit_header', confidence: 'high', evidence: line.trim().slice(0, 240) }
    }
  }

  // Only an explicit conversation/pairing tag that also names the assigned character is
  // decisive enough to stand alone; generic "name threads" tags remain supporting evidence.
  const tagCandidates: Array<{ field: ParsedField<string[]>; signature: string }> = []
  for (const tag of tags) {
    const match = /^(?:convo|conversation|pairing|ship)s?\s*[:\-–—]?\s*(.{2,180})$/iu.exec(plain(tag).trim())
    if (!match) continue
    const names = splitNames(match[1])
    if (!names.some(name => isOwnMuse(name, assignedCharacterName))) continue
    const partners = names.filter(name => !isOwnMuse(name, assignedCharacterName)).map(displayTagName)
    if (!partners.length) continue
    const value = [...new Map(partners.map(name => [key(name), name])).values()]
    tagCandidates.push({
      field: { value, source: 'high_confidence_tag', confidence: 'high', evidence: tag.trim().slice(0, 240) },
      signature: value.map(key).sort().join('|'),
    })
  }
  const tagSignatures = new Set(tagCandidates.map(candidate => candidate.signature))
  if (tagSignatures.size === 1) return tagCandidates[0].field
  if (tagSignatures.size > 1) return unresolved<string[]>()
  return unresolved<string[]>()
}

export function extractWhere(texts: string[]): ParsedField<string> {
  for (const text of texts) for (const line of plain(text).split(/\r?\n/u).slice(0, 30)) {
    const match = /^\s*(?:where|setting)\s*:\s*(.{2,180})\s*$/iu.exec(line)
    if (match) return { value: match[1].trim(), source: 'explicit_header', confidence: 'high', evidence: line.trim().slice(0, 240) }
  }
  return unresolved<string>()
}

function compact(text: string): string {
  const sentences = text.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?])\s+/u).slice(0, 2).join(' ')
  return sentences.length > 360 ? `${sentences.slice(0, 357).trimEnd()}.` : sentences
}

/** Stable premise from the root starter only. If that post is unavailable, callers should pass no text. */
export function extractStablePremise(rootText: string | null | undefined, where?: string | null): ParsedField<string> {
  const lines = plain(rootText ?? '').split(/\r?\n/u).map(line => line.trim())
    .filter(line => line && !headerValue(line) && !/^\s*(?:where|setting|when|verse|tags?|muses?|characters?|cast|notes?|tw|cw)\s*:/iu.test(line)
      && !/^\s*(?:via|source|reblogged from|written by|posted by|credit|thread by)\s*:/iu.test(line)
      && !/^\s*(?:keep reading|read more|continue reading|tags?:|navigation:)\b/iu.test(line)
      && !/^\s*(?:\[[^\]]*\]|\([^)]*\))\s*$/u.test(line)
      && !/^[\p{P}\p{S}\s]+$/u.test(line))
  const opening = compact(lines.join(' '))
  const combined = [where?.trim().replace(/[.\s]+$/u, ''), opening].filter(Boolean).join('. ')
  const value = combined.length > 360 ? `${combined.slice(0, 357).trimEnd()}.` : combined
  if (!value) return unresolved<string>()
  return { value, source: 'root_starter', confidence: 'high', evidence: value.slice(0, 240) }
}

/** Extracts text authored by the latest poster, not the copied reblog trail. */
export function extractDirectReplyText(voices: Array<{ blogIdentifier: string; text: string }> | undefined, posterBlog: string): string | null {
  const wanted = posterBlog.toLowerCase().replace(/^@/u, '')
  const direct = voices?.find(voice => voice.blogIdentifier.toLowerCase().replace(/^@/u, '') === wanted)?.text
  const cleaned = direct ? plain(direct).replace(/[\t ]+/gu, ' ').replace(/\n\s*/gu, '\n').trim() : ''
  return cleaned || null
}

export function fieldValue<T>(value: T | null, source: FieldSource, confidence: ParseConfidence, evidence: string | null = null): ParsedField<T> {
  return { value, source, confidence, evidence }
}
