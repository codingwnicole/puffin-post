// True when an element is a text-editing surface. Global shortcuts (Ctrl/⌘K)
// must not open the command menu while the user is typing.
export function isEditableElement(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && isEditableElement(target)
}
