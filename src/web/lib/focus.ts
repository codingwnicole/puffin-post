import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'

// Modal keyboard basics for every dialog: move focus inside on open, keep Tab/Shift+Tab inside,
// and hand focus back to whatever opened it on close.
// ponytail: hand-rolled for the 5 existing modals; the redesign should move them to native <dialog>.showModal(), which does all of this.
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const node = ref.current
    if (!active || !node) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const items = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0)
    if (!node.contains(document.activeElement)) (items()[0] ?? node).focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const list = items()
      if (!list.length) { event.preventDefault(); return }
      const first = list[0], last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => { node.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [ref, active])
}
