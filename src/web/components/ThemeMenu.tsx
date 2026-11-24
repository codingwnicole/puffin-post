import { useState } from 'react'
import { applyThemePreference, DESK_THEMES, readThemePreference, saveThemePreference, type ThemePreference } from '../lib/theme'

export default function ThemeMenu() {
  const [preference, setPreference] = useState(readThemePreference)
  function change(next: ThemePreference) {
    if (next.desk === 'meadow') delete next.desk
    setPreference(next)
    saveThemePreference(next)
    applyThemePreference(next) // main.tsx re-reads storage when the system theme changes
  }

  return (
    <fieldset className="theme-menu">
      <legend>Make yourself at home</legend>
      <label>Theme
        <select value={preference.mode} onChange={event => change({ ...preference, mode: event.target.value as ThemePreference['mode'] })}>
          <option value="system">Use system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <fieldset className="desk-themes">
        <legend>Desk theme</legend>
        {DESK_THEMES.map(([id, label]) => (
          <label key={id} className="desk-theme">
            <input type="radio" name="desk-theme" value={id} checked={(preference.desk ?? 'meadow') === id} onChange={() => change({ ...preference, desk: id })} />
            <span className="desk-swatch" data-desk-swatch={id} aria-hidden="true" />
            {label}
          </label>
        ))}
      </fieldset>
    </fieldset>
  )
}
