export type ThemePreference = {
  mode: 'light' | 'dark' | 'system'
  palette: 'rose' | 'violet' | 'ocean' | 'sage' | 'ember' | 'midnight'
}

const storageKey = 'puffin-post.theme'
const defaultPreference: ThemePreference = { mode: 'system', palette: 'rose' }

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value: unknown = JSON.parse((storage ?? window.localStorage).getItem(storageKey) ?? 'null')
    if (value && typeof value === 'object' && 'mode' in value && 'palette' in value
      && typeof value.mode === 'string' && ['light', 'dark', 'system'].includes(value.mode)
      && typeof value.palette === 'string' && ['rose', 'violet', 'ocean', 'sage', 'ember', 'midnight'].includes(value.palette)) {
      return { mode: value.mode, palette: value.palette } as ThemePreference
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
