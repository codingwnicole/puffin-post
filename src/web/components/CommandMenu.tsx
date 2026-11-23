import { useEffect, useMemo, useRef, useState } from 'react'
import { useNativeDialog } from '../lib/dialog'

// Command menu (Ctrl/⌘K). A filter box plus a list of destinations/actions.
// Navigates via hash routes so the existing router picks them up.
const isMac = typeof navigator !== 'undefined' &&
  (/Mac/i.test(navigator.platform) || /iPhone|iPad/i.test(navigator.userAgent))

type Command = { id: string; label: string; route: string }

export default function CommandMenu({ open, onClose }:{ open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useNativeDialog(dialogRef, open)

  const commands: Command[] = useMemo(() => [
    { kind: 'route', id: 'add-thread', label: 'Add thread', route: 'quick-add' },
    { kind: 'route', id: 'characters', label: 'Characters', route: 'characters' },
    { kind: 'route', id: 'activity', label: 'Tumblr activity', route: 'activity' },
    { kind: 'route', id: 'archived', label: 'Archived threads', route: 'dashboard?archived=1' },
    { kind: 'route', id: 'planner', label: 'Character planner', route: 'planner' },
    { kind: 'route', id: 'settings', label: 'Settings', route: 'settings' },
  ], [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands
  }, [commands, query])

  // Keep the highlight in range when the filter changes.
  useEffect(() => { setActive(0) }, [query])

  // Focus the input on open.
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  if (!open) return null

  function activate(command: Command) {
    window.location.hash = '#' + command.route
    dismiss()
  }

  function dismiss() { dialogRef.current?.close(); onClose() }

  function trapDialogTab(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0)
    if (!focusable.length) { event.preventDefault(); return }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[active]
      if (command) activate(command)
      return
    }
  }

  return (
    <dialog ref={dialogRef} className="modal-overlay command-overlay" aria-label="Command menu" onKeyDown={trapDialogTab} onCancel={event => { event.preventDefault(); dismiss() }} onClick={event => { if (event.target === event.currentTarget) dismiss() }}>
      <div className="modal-card command-card" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-input"
          value={query}
          placeholder="Search / commands"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="command-list" role="listbox" aria-label="Commands">
          {filtered.map((command, index) => (
            <li key={command.id} role="option" aria-selected={index === active}
              className={'command-item' + (index === active ? ' command-item-active' : '')}
              onMouseEnter={() => setActive(index)}
              onClick={() => activate(command)}>
              {command.label}
            </li>
          ))}
          {filtered.length === 0 && <li className="command-empty">No matching commands</li>}
        </ul>
      </div>
    </dialog>
  )
}
