import { useEffect, useState } from 'react'

// Entrance animations (CSS `rise` with --i stagger) should play once, when the list first
// appears, not again every time a reload re-renders it. Pass `ready` = "the list is on screen"
// and put `data-entered={entered ? '' : undefined}` on its container; styles.css turns the child
// animations off once the attribute is set.
export function useEntered(ready = true, delay = 700) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!ready || entered) return
    const timer = window.setTimeout(() => setEntered(true), delay)
    return () => window.clearTimeout(timer)
  }, [ready, entered, delay])
  return entered
}
