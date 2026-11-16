import type { TumblrActivity } from './client'

export interface RefreshBranch {
  id: string
  partnerBlogIdentifier: string | null
  latestPostId: string | null
  status: string
  statusManualOverrideAt: string | null
}

export interface RefreshInput {
  workspaceId: string
  starterId: string
  rootBlogIdentifier: string
  ownBlogIdentifiers: string[]
  branches: RefreshBranch[]
  activities: TumblrActivity[]
  now: Date
}

export interface RefreshResult { updatedBranchIds:string[]; detectedActivityCount:number }

export function latestDirectExchange(ownBlogIdentifiers:string[], rootBlogIdentifier:string, partnerBlogIdentifier:string, activities:TumblrActivity[]) {
  const ownBlogs = new Set(ownBlogIdentifiers)
  let latest: { activity:TumblrActivity; status:'your_turn'|'their_turn' } | undefined
  for (const activity of [...activities].sort((left,right) => left.timestamp.localeCompare(right.timestamp))) {
    const isPartnerActivity = activity.blogIdentifier === partnerBlogIdentifier
    const isOwnActivity = ownBlogs.has(activity.blogIdentifier)
    const parent = activity.parentBlogIdentifier ?? ''
    // A partner reblogging from you (or from your root) means their turn is over; you owe the next reply.
    if (isPartnerActivity && (ownBlogs.has(parent) || parent === rootBlogIdentifier && ownBlogs.has(rootBlogIdentifier))) latest = { activity, status:'your_turn' }
    // Your reblog from that partner means you have replied and are waiting on them.
    // Skip when the partner IS one of your own blogs (shared blog) — the activity is ambiguous there.
    if (isOwnActivity && parent === partnerBlogIdentifier && !ownBlogs.has(partnerBlogIdentifier)) latest = { activity, status:'their_turn' }
    // Your reblog from the root post also clears your obligation if the partner is the original poster.
    if (isOwnActivity && !isPartnerActivity && parent === rootBlogIdentifier && partnerBlogIdentifier === rootBlogIdentifier) latest = { activity, status:'their_turn' }
  }
  return latest
}

/** Finds the latest direct exchange between a tracked partner and one of the character's blogs. */
export async function refreshStarterBranches(input:RefreshInput, apply:(branch:RefreshBranch, activity:TumblrActivity, status:'your_turn'|'their_turn') => Promise<void>):Promise<RefreshResult> {
  const updatedBranchIds:string[] = []
  for (const branch of input.branches) {
    if (!branch.partnerBlogIdentifier) continue
    const latest = latestDirectExchange(input.ownBlogIdentifiers,input.rootBlogIdentifier,branch.partnerBlogIdentifier,input.activities)
    if (!latest || latest.activity.postId === branch.latestPostId) continue
    await apply(branch, latest.activity, latest.status)
    updatedBranchIds.push(branch.id)
  }
  return { updatedBranchIds, detectedActivityCount:input.activities.length }
}
