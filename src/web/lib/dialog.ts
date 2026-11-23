import { useLayoutEffect, type RefObject } from 'react'

export function useNativeDialog(ref: RefObject<HTMLDialogElement | null>, active = true) {
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!active || !dialog) return
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [active, ref])
}
