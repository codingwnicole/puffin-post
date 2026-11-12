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
  branches: RefreshBranch[]
  activities: TumblrActivity[]
  now: Date
}

export interface RefreshResult { updatedBranchIds: string[]; detectedActivityCount: number }

/** Applies remote partner activity to its own branch only. Manual statuses always win. */
export async function refreshStarterBranches(input: RefreshInput, apply: (branch: RefreshBranch, activity: TumblrActivity) => Promise<void>): Promise<RefreshResult> {
  const latestByPartner = new Map<string, TumblrActivity>()
  for (const activity of input.activities) {
    if (activity.blogIdentifier === input.rootBlogIdentifier || !activity.postId) continue
    const current = latestByPartner.get(activity.blogIdentifier)
    if (!current || activity.timestamp > current.timestamp) latestByPartner.set(activity.blogIdentifier, activity)
  }
  const updatedBranchIds: string[] = []
  for (const branch of input.branches) {
    const activity = branch.partnerBlogIdentifier ? latestByPartner.get(branch.partnerBlogIdentifier) : undefined
    if (!activity || activity.postId === branch.latestPostId) continue
    await apply(branch, activity)
    updatedBranchIds.push(branch.id)
  }
  return { updatedBranchIds, detectedActivityCount: latestByPartner.size }
}
