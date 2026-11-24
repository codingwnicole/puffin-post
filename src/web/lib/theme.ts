export const DESK_THEMES = [['meadow', 'Meadow'], ['tidepool', 'Tidepool'], ['lavender', 'Lavender hour'], ['mushroom', 'Mushroom']] as const
export type DeskTheme = typeof DESK_THEMES[number][0]

export type ThemePreference = {
  mode: 'light' | 'dark' | 'system'
  /** Accent family ("dashboard skins" on the roadmap). Absent means Meadow, the default. */
  desk?: DeskTheme
}

const storageKey = 'puffin-post.theme'
const defaultPreference: ThemePreference = { mode: 'system' }
const deskIds: readonly string[] = DESK_THEMES.map(([id]) => id)

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value: unknown = JSON.parse((storage ?? window.localStorage).getItem(storageKey) ?? 'null')
    if (value && typeof value === 'object' && 'mode' in value
      && typeof value.mode === 'string' && ['light', 'dark', 'system'].includes(value.mode)) {
      const preference = { mode: value.mode } as ThemePreference
      if ('desk' in value && typeof value.desk === 'string' && value.desk !== 'meadow' && deskIds.includes(value.desk)) preference.desk = value.desk as DeskTheme
      return preference
    }
  } catch { /* Storage can be blocked or contain stale data. */ }
  return { ...defaultPreference }
}

export function saveThemePreference(preference: ThemePreference, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? window.localStorage).setItem(storageKey, JSON.stringify(preference))
  } catch { /* The current session still works when persistence is unavailable. */ }
}

export function resolveTheme(mode: ThemePreference['mode'], systemIsDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemIsDark ? 'dark' : 'light') : mode
}

/** Puts a preference on <html>. Called once at startup (main.tsx) and whenever Settings changes it. */
export function applyThemePreference(preference: ThemePreference, systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches) {
  const root = document.documentElement, mode = resolveTheme(preference.mode, systemIsDark)
  root.dataset.theme = mode
  root.style.colorScheme = mode
  if (preference.desk) root.dataset.desk = preference.desk
  else delete root.dataset.desk
}
