// Finding the writing partner's muse name when the RP header doesn't give it.

const titleCase = (name: string) => name.replace(/(^|[\s'-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase())
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wholeWord = (word: string) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}($|[^\\p{L}])`, 'giu')

// RPers tag their own muse on their posts: "chayton threads", "convo: chayton and ilyas".
// Names come only from those shapes, minus the user's own character, and must also appear in the
// thread text, so an unrelated tag never becomes a title.
export function museNamesFromTags(tags: string[], text: string, isOwn: (name: string) => boolean) {
  const names: string[] = []
  for (const raw of tags) {
    const tag = raw.toLowerCase().trim()
    const convo = /^(?:convo|conversation|ship|pairing)s?\s*[:\-–]?\s+(.+)$/u.exec(tag)
    const threads = /^([\p{L}][\p{L}' -]{1,30}?)(?:'s)?\s+(?:threads?|starters?|replies)$/u.exec(tag)
    if (convo) names.push(...convo[1].split(/\s*(?:&|\+|\/|,|\band\b|\bx\b)\s*/u))
    else if (threads) names.push(threads[1])
  }
  const lower = text.toLowerCase()
  return names.map(name => name.trim())
    .filter((name, index, all) => /^[\p{L}][\p{L}' -]{1,30}$/u.test(name) && !isOwn(name) && all.indexOf(name) === index && wholeWord(name).test(lower))
    .map(titleCase)
}

// Words that open sentences in third-person RP prose but are never a muse's name.
const NOT_NAMES = new Set(('i you he she they we it his her hers their theirs its him them me us my your our this that these those there here then '
  + 'the a an and but or so if as when while once after before because though although since until what who whom whose why how where which '
  + 'now just still even only maybe perhaps not no yes oh well one someone something somebody everyone everything nothing nobody anyone anything '
  + 'all both each every some most many much more few other another such same own very too also again already always never ever soon '
  + 'it\'s he\'s she\'s they\'re there\'s that\'s what\'s let\'s i\'m you\'re we\'re time today tonight everything instead finally suddenly').split(' '))

/**
 * The partner's muse from their own prose. Third-person RP names the muse where a sentence starts
 * ("mateo recognizes him…") or right after dialogue ("…" chayton says). Candidates come only from the
 * partner's text, skip pronouns/common words and the user's own muse, and must show up in the user's
 * replies too (people write about their partner's character) or at least twice in the partner's text.
 * ponytail: a heuristic, not NLP; it returns null rather than guess, and the title then falls back to the blog name.
 */
export function museNameFromProse(partnerText: string, userText: string, isOwn: (name: string) => boolean): string | null {
  const text = partnerText.toLowerCase(), mine = userText.toLowerCase()
  const counts = new Map<string, number>()
  const sentenceStart = /(?:^|[.!?…]\s+|["”“']\s*|\n)([\p{L}][\p{L}'-]{1,20})\s+(\p{L}+(?:s|ed))\b/gu
  for (const match of text.matchAll(sentenceStart)) {
    const word = match[1].replace(/'s$/, '')
    if (word.length < 3 || NOT_NAMES.has(word) || isOwn(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  let best: { name: string; score: number } | null = null
  for (const [name, starts] of counts) {
    const inPartner = text.match(wholeWord(name))?.length ?? 0, inMine = mine.match(wholeWord(name))?.length ?? 0
    if (!inMine && inPartner < 2) continue
    const score = starts * 2 + inPartner + inMine * 2
    if (!best || score > best.score) best = { name, score }
  }
  return best ? titleCase(best.name) : null
}
