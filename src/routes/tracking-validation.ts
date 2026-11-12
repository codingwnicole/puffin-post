import { z } from 'zod'

export const reference = z.string().trim().min(1).max(200)
export const branchSchema = z.object({
  partnerId: reference.nullable().optional(),
  status: z.enum(['your_turn', 'their_turn', 'queued', 'archived']).optional(),
  notes: z.string().max(20000).optional(),
}).strict()
export const starterSchema = z.object({
  characterId: reference, title: z.string().trim().min(1).max(300),
  rootPostId: z.string().regex(/^\d{1,30}$/), rootBlogId: reference,
  description: z.string().max(20000).optional(),
}).strict()
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(300), notes: z.string().max(20000).optional(),
  characterId: reference.nullable().optional(), partnerId: reference.nullable().optional(),
  sourceUrl: z.url().max(2000).refine(value => ['https:', 'http:'].includes(new URL(value).protocol)).nullable().optional(),
  reminderAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullable().optional(),
}).strict()
export const draftPatchSchema = draftSchema.partial().extend({ state: z.enum(['open','archived']).optional() }).strict()
export const conversionSchema = z.object({ starter: starterSchema, branch: branchSchema.optional() }).strict()
