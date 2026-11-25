import { canonicalBlogIdentifier } from './normalize'

type BlogMetadata = {
  blogs?: unknown
  uuids?: Record<string, string>
  aliases?: Record<string, string>
}

export interface OwnedTumblrBlogs {
  identifiers: Set<string>
  complete: boolean
  uuidByIdentifier: Map<string, string>
}

function parseMetadata(value: string): BlogMetadata | null {
  try {
    const parsed = JSON.parse(value) as BlogMetadata
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

/** Build the exact, account-authorized set of Tumblr blogs for a workspace.
 * UUID aliases are trusted only while that UUID is still present on an active
 * connection. Similar display names are never used as identity evidence. */
export function ownedTumblrBlogs(metadataJson: string[]): OwnedTumblrBlogs {
  const identifiers = new Set<string>()
  const uuidByIdentifier = new Map<string, string>()
  let complete = metadataJson.length > 0
  for (const raw of metadataJson) {
    const metadata = parseMetadata(raw)
    if (!metadata || !Array.isArray(metadata.blogs)) { complete = false; continue }
    const currentUuids = metadata.uuids ?? {}
    const activeUuids = new Set(Object.keys(currentUuids))
    for (const rawIdentifier of metadata.blogs) {
      if (typeof rawIdentifier !== 'string' || !rawIdentifier.trim()) { complete = false; continue }
      const identifier = canonicalBlogIdentifier(rawIdentifier)
      identifiers.add(identifier)
      const uuid = Object.entries(currentUuids).find(([, name]) => canonicalBlogIdentifier(name) === identifier)?.[0]
      if (uuid) uuidByIdentifier.set(identifier, uuid)
    }
    for (const [rawAlias, uuid] of Object.entries(metadata.aliases ?? {})) {
      if (!activeUuids.has(uuid)) continue
      identifiers.add(canonicalBlogIdentifier(rawAlias))
      uuidByIdentifier.set(canonicalBlogIdentifier(rawAlias), uuid)
    }
  }
  return { identifiers, complete, uuidByIdentifier }
}

export type StarterAuthorAttribution = {
  status: 'user' | 'partner' | 'unresolved'
  blogIdentifier: string | null
  source: 'connected_blog' | 'tumblr_root' | 'unresolved'
  confidence: 'high' | 'none'
  evidence: string
  blogUuid: string | null
}

/** Root author is distinct from the author of the selected reply. A positive
 * authorized-blog match can survive a temporary root fetch failure. Absence
 * from the connection list is only enough to say "partner" once Tumblr also
 * returned the root post and a complete active-account snapshot. */
export function attributeStarterAuthor(input: {
  rootBlogIdentifier?: string | null
  rootResolved: boolean
  rootPostAvailable: boolean
  ownedBlogs: OwnedTumblrBlogs
}): StarterAuthorAttribution {
  const identifier = input.rootBlogIdentifier ? canonicalBlogIdentifier(input.rootBlogIdentifier) : null
  if (!identifier || !input.rootResolved) return {
    status: 'unresolved', blogIdentifier: identifier, source: 'unresolved', confidence: 'none',
    evidence: 'Tumblr did not provide a reliable original-post identity.', blogUuid: null,
  }
  if (input.ownedBlogs.identifiers.has(identifier)) {
    return {
      status: 'user', blogIdentifier: identifier, source: 'connected_blog', confidence: 'high',
      evidence: `Original starter blog ${identifier} matches an authorized connected Tumblr blog.`,
      blogUuid: input.ownedBlogs.uuidByIdentifier.get(identifier) ?? null,
    }
  }
  if (!input.rootPostAvailable || !input.ownedBlogs.complete) return {
    status: 'unresolved', blogIdentifier: identifier, source: 'unresolved', confidence: 'none',
    evidence: 'The original post or the complete connected-blog list could not be verified.', blogUuid: null,
  }
  return {
    status: 'partner', blogIdentifier: identifier, source: 'tumblr_root', confidence: 'high',
    evidence: `Tumblr confirmed the original starter on ${identifier}, which is not on an active connected account.`,
    blogUuid: null,
  }
}
