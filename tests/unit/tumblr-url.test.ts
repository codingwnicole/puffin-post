import { expect, it } from 'vitest'
import { parseTumblrPostReference } from '../../src/tumblr/normalize'
import { validateStarterPost } from '../../src/routes/tracking-validation'

it('parses canonical Tumblr post URLs only', () => {
  expect(parseTumblrPostReference('https://Mine.Tumblr.com/post/123/a-title')).toEqual({ blogIdentifier:'mine.tumblr.com', postId:'123' })
  expect(() => parseTumblrPostReference('http://mine.tumblr.com/post/123')).toThrow('Invalid Tumblr post URL')
  expect(() => parseTumblrPostReference('https://evil.example/post/123')).toThrow('Invalid Tumblr post URL')
  expect(parseTumblrPostReference('https://www.tumblr.com/emerald0ceans/831045515449909248/a-post?source=share')).toEqual({ blogIdentifier:'emerald0ceans.tumblr.com', postId:'831045515449909248' })
})

it('rejects a Tumblr post reference whose blog differs from the selected character blog', () => {
  expect(() => validateStarterPost({ selectedBlogIdentifier:'mine.tumblr.com', postUrl:'https://other.tumblr.com/post/1' })).toThrow('does not belong to the selected blog')
})
