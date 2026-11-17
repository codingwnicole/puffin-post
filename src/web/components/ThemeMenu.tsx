import { useLayoutEffect, useState } from 'react'
import { readThemePreference, resolveTheme, saveThemePreference, type ThemePreference } from '../lib/theme'

export default function ThemeMenu() {
  const [preference, setPreference] = useState(readThemePreference)
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const mode = resolveTheme(preference.mode, media.matches)
      document.documentElement.dataset.theme = mode
      delete document.documentElement.dataset.palette
      document.documentElement.style.colorScheme = mode
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  function change(next: ThemePreference) {
    setPreference(next)
    saveThemePreference(next)
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
    </fieldset>
  )
}
