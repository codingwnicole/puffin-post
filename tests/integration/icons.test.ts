import { describe,it,expect } from 'vitest'
import { iconContentTypeAllowed } from '../../src/storage/icons'

describe('private character icons',()=>{
  it('accepts only small raster image formats',()=>{
    expect(iconContentTypeAllowed('image/png')).toBe(true)
    expect(iconContentTypeAllowed('image/webp')).toBe(true)
    expect(iconContentTypeAllowed('image/svg+xml')).toBe(false)
    expect(iconContentTypeAllowed('text/html')).toBe(false)
  })
})
