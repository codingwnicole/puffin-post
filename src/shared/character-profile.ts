import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max)
const entryList = (maxItems: number, maxLength: number) => z.array(text(maxLength)).max(maxItems)
const emptyTextSection = (maxLength: number) => z.object({ enabled: z.boolean().default(false), text: text(maxLength).default('') }).strict().default({ enabled: false, text: '' })
export const PROFILE_SECTION_ORDER = ['introduction','biography','basics','personality','relationships','quotes','songs','trivia','social','quizzes','quicklinks'] as const
export type ProfileSection = typeof PROFILE_SECTION_ORDER[number]
export const PROFILE_SECTION_LABELS: Record<ProfileSection, string> = {
  introduction: 'Introduction', biography: 'Biography', basics: 'Character details', personality: 'Personality & traits',
  relationships: 'Relationships', quotes: 'Quotes', songs: 'Theme songs', trivia: 'Trivia & headcanons',
  social: 'Fictional social profile', quizzes: 'Quizzes & results', quicklinks: 'Quick links',
}

export const characterProfileSchema = z.object({
  sectionOrder: z.array(z.enum(PROFILE_SECTION_ORDER)).length(PROFILE_SECTION_ORDER.length).default([...PROFILE_SECTION_ORDER])
    .superRefine((order, context) => { if (new Set(order).size !== order.length) context.addIssue({ code: 'custom', message: 'Section order cannot contain duplicates' }) }),
  introduction: emptyTextSection(800),
  biography: emptyTextSection(6000),
  basics: z.object({
    enabled: z.boolean().default(false), pronouns: text(80).default(''), age: text(40).default(''),
    birthday: text(60).default(''), occupation: text(100).default(''), location: text(100).default(''),
  }).strict().default({ enabled: false, pronouns: '', age: '', birthday: '', occupation: '', location: '' }),
  personality: z.object({ enabled: z.boolean().default(false), summary: text(3000).default(''), traits: entryList(16, 60).default([]) }).strict()
    .default({ enabled: false, summary: '', traits: [] }),
  relationships: z.object({ enabled: z.boolean().default(false), entries: entryList(30, 300).default([]) }).strict()
    .default({ enabled: false, entries: [] }),
  quotes: z.object({ enabled: z.boolean().default(false), entries: entryList(30, 500).default([]) }).strict()
    .default({ enabled: false, entries: [] }),
  songs: z.object({ enabled: z.boolean().default(false), entries: entryList(30, 300).default([]) }).strict()
    .default({ enabled: false, entries: [] }),
  trivia: z.object({ enabled: z.boolean().default(false), entries: entryList(40, 500).default([]) }).strict()
    .default({ enabled: false, entries: [] }),
  quizzes: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
  quicklinks: z.object({ enabled: z.boolean().default(false) }).strict().default({ enabled: false }),
  social: z.object({
    enabled: z.boolean().default(false), format: z.enum(['photo-journal', 'short-posts', 'media-shelf']).default('short-posts'),
    displayName: text(80).default(''), username: text(40).regex(/^[\w.-]*$/u).default(''), bio: text(500).default(''),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/iu).default('#687e70'),
    followers: z.number().int().min(0).max(999_999_999).nullable().default(null),
    following: z.number().int().min(0).max(999_999_999).nullable().default(null),
    posts: entryList(12, 500).default([]),
  }).strict().default({ enabled: false, format: 'short-posts', displayName: '', username: '', bio: '', accentColor: '#687e70', followers: null, following: null, posts: [] }),
}).strict()

export type CharacterProfile = z.infer<typeof characterProfileSchema>
export const emptyCharacterProfile = (): CharacterProfile => characterProfileSchema.parse({})

/** Stored JSON is revalidated before public rendering so malformed or old
 * snapshots can never leak additional/private fields into public markup. */
export function parsePublicCharacterProfile(raw: string | null | undefined): CharacterProfile {
  if (!raw) return emptyCharacterProfile()
  try { return characterProfileSchema.parse(JSON.parse(raw)) } catch { return emptyCharacterProfile() }
}
