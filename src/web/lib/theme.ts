export type ThemePreference = {
  mode: 'light' | 'dark' | 'system'
}

const storageKey = 'puffin-post.theme'
const defaultPreference: ThemePreference = { mode: 'system' }

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value: unknown = JSON.parse((storage ?? window.localStorage).getItem(storageKey) ?? 'null')
    if (value && typeof value === 'object' && 'mode' in value
      && typeof value.mode === 'string' && ['light', 'dark', 'system'].includes(value.mode)) {
      return { mode: value.mode } as ThemePreference
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
