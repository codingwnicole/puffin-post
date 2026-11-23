/**
 * Compatibility helpers for older internal callers. Muse identity must come
 * from explicit metadata, never ordinary prose.
 */
const titleCase = (name: string) => name.replace(/(^|[\s'-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toLocaleUpperCase())

export function museNamesFromTags(tags: string[], _text: string, isOwn: (name: string) => boolean): string[] {
  const names: string[] = []
  for (const raw of tags) {
    const match = /^(?:convo|conversation|pairing|ship)s?\s*[:\-–—]?\s*(.{2,180})$/iu.exec(raw.trim())
    if (!match) continue
    const pair = match[1].split(/\s*(?:&|×|\+|\/|,|;|\band\b|\bx\b)\s*/iu)
      .map(name => name.trim().replace(/^[\s@#(\[]+|[\s#)\]]+$/gu, ''))
      .filter(name => /^[\p{L}][\p{L}\p{M} .'-]{1,59}$/u.test(name))
    if (pair.length < 2) continue
    if (!pair.some(isOwn)) continue
    for (const name of pair) if (!isOwn(name) && !names.some(saved => saved.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(titleCase(name))
  }
  return names
}

/** Ordinary prose is ambiguous, so this intentionally never guesses a name. */
export function museNameFromProse(_partnerText: string, _userText: string, _isOwn: (name: string) => boolean): null {
  return null
}
