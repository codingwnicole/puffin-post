import { z } from 'zod'
import { canonicalBlogIdentifier, parseTumblrPostReference } from '../tumblr/normalize'

export const reference = z.string().trim().min(1).max(200)
export const branchSchema = z.object({
  partnerId: reference.nullable().optional(),
  status: z.enum(['your_turn', 'their_turn', 'queued', 'archived']).optional(),
  notes: z.string().max(20000).optional(),
  partnerMuses: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  userRecap: z.string().max(1000).optional(),
  nextCheckAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullable().optional(),
}).strict()
export const starterSchema = z.object({
  characterId: reference, title: z.string().trim().max(300).optional(),
  postUrl: z.string().trim().max(2000).optional(),
  initialTurn: z.enum(['your_turn', 'their_turn']).optional(),
  groupId: reference.nullable().optional(),
  partnerBlogIdentifier: z.string().trim().max(200).nullable().optional(),
  partnerName: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(20000).optional(),
}).strict()

export function validateStarterPost(input: { selectedBlogIdentifier: string; postUrl: string }) {
  const post = parseTumblrPostReference(input.postUrl)
  if (post.blogIdentifier !== canonicalBlogIdentifier(input.selectedBlogIdentifier)) throw new Error('Post does not belong to the selected blog')
  return post
}
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(300), notes: z.string().max(20000).optional(),
  purpose: z.enum(['reply','plotting','starter_idea','note']).optional(),
  characterId: reference.nullable().optional(), partnerId: reference.nullable().optional(),
  characterIds: z.array(reference).max(20).optional(),
  sourceUrl: z.url().max(2000).refine(value => ['https:', 'http:'].includes(new URL(value).protocol)).nullable().optional(),
  reminderAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullable().optional(),
}).strict()
export const draftPatchSchema = draftSchema.partial().extend({ state: z.enum(['open','archived']).optional() }).strict()
export const conversionSchema = z.object({ starter: starterSchema.extend({ title:z.string().trim().min(1).max(300) }), branch: branchSchema.optional() }).strict()
