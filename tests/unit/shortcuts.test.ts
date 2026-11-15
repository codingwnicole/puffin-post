import { describe, expect, it } from 'vitest'
import { isEditableElement } from '../../src/web/lib/shortcuts'

// Pure check over an element's tagName/isContentEditable, so it runs in the
// node test env with no DOM. The DOM wrapper isEditableTarget just adds the
// `instanceof HTMLElement` guard around this.
function element(tag: string, isContentEditable = false) {
  return { tagName: tag, isContentEditable }
}

describe('isEditableElement', () => {
  it('returns true for editable surfaces so shortcuts stay quiet while typing', () => {
    expect(isEditableElement(element('INPUT'))).toBe(true)
    expect(isEditableElement(element('TEXTAREA'))).toBe(true)
    expect(isEditableElement(element('SELECT'))).toBe(true)
    expect(isEditableElement(element('DIV', true))).toBe(true)
  })

  it('returns false for plain elements and a null target', () => {
    expect(isEditableElement(element('BUTTON'))).toBe(false)
    expect(isEditableElement(element('DIV'))).toBe(false)
    expect(isEditableElement(null)).toBe(false)
  })
})
