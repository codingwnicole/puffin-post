import { expect, it } from 'vitest'
import { attributeStarterAuthor, ownedTumblrBlogs } from '../../src/tumblr/blog-identities'
import { blogMetadata } from '../../src/tumblr/client'

it('preserves rename aliases only for the same currently authorized Tumblr UUID', () => {
  const next = blogMetadata([{ identifier:'renamed.tumblr.com', uuid:'stable-1' }], new Date('2026-11-25T00:00:00Z'), {
    uuids:{ 'stable-1':'old-name.tumblr.com', 'removed':'former.tumblr.com' },
    aliases:{ 'older.tumblr.com':'stable-1', 'removed-alias.tumblr.com':'removed' },
  })
  expect(next.aliases).toEqual({ 'older.tumblr.com':'stable-1', 'old-name.tumblr.com':'stable-1' })
  const owned = ownedTumblrBlogs([JSON.stringify(next)])
  expect(owned.identifiers.has('old-name.tumblr.com')).toBe(true)
  expect(owned.uuidByIdentifier.get('old-name.tumblr.com')).toBe('stable-1')
  expect(owned.identifiers.has('former.tumblr.com')).toBe(false)
})

it('does not match similar blog identifiers and keeps uncertain root authors unresolved', () => {
  const owned = ownedTumblrBlogs([JSON.stringify({ blogs:['writer.tumblr.com'], uuids:{ 'uuid-1':'writer.tumblr.com' } })])
  expect(attributeStarterAuthor({ rootBlogIdentifier:'writer-two.tumblr.com', rootResolved:true, rootPostAvailable:false, ownedBlogs:owned }).status).toBe('unresolved')
  expect(attributeStarterAuthor({ rootBlogIdentifier:'writer-two.tumblr.com', rootResolved:true, rootPostAvailable:true, ownedBlogs:owned }).status).toBe('partner')
  expect(attributeStarterAuthor({ rootBlogIdentifier:'writer.tumblr.com', rootResolved:false, rootPostAvailable:true, ownedBlogs:owned }).status).toBe('unresolved')
})
