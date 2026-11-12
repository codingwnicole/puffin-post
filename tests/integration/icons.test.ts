import { describe,it,expect } from 'vitest'
import { iconContentTypeAllowed, validatedRasterType } from '../../src/storage/icons'

describe('private character icons',()=>{
  it('accepts only small raster image formats',()=>{
    expect(iconContentTypeAllowed('image/png')).toBe(true)
    expect(iconContentTypeAllowed('image/webp')).toBe(true)
    expect(iconContentTypeAllowed('image/svg+xml')).toBe(false)
    expect(iconContentTypeAllowed('text/html')).toBe(false)
  })
  it('rejects SVG bytes disguised as a PNG upload',async()=>{
    const fakePng = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],'icon.png',{type:'image/png'})
    await expect(validatedRasterType(fakePng)).rejects.toThrow('unsupported image type')
  })
})
