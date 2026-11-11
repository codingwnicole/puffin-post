import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { initialsFor, InitialsAvatar } from '../../src/web/components/InitialsAvatar'
import { readThemePreference, resolveTheme, saveThemePreference } from '../../src/web/lib/theme'

describe('theme preferences', () => {
  it('follows the system until a valid preference is saved', () => {
    const storage = new Map<string, string>()
    const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
    expect(readThemePreference(local)).toEqual({ mode: 'system', palette: 'rose' })
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    saveThemePreference({ mode: 'light', palette: 'ocean' }, local)
    expect(readThemePreference(local)).toEqual({ mode: 'light', palette: 'ocean' })
  })

  it.each(['{', 'null', '[]', '{"mode":"sepia","palette":"rose"}', '{"mode":"dark","palette":"neon"}', '{"mode":["dark"],"palette":"rose"}', '{"mode":"dark","palette":["ocean"]}'])('ignores invalid saved preferences: %s', value => {
    expect(readThemePreference({ getItem: () => value })).toEqual({ mode: 'system', palette: 'rose' })
  })

  it('works when local storage is unavailable', () => {
    expect(readThemePreference({ getItem: () => { throw new Error('blocked') } })).toEqual({ mode: 'system', palette: 'rose' })
    expect(() => saveThemePreference({ mode: 'dark', palette: 'violet' }, { setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})

describe('character avatars', () => {
  it.each([['Parisa Farzaneh', 'PF'], ['  parisa   farzaneh ', 'PF'], ['Parisa', 'PA'], ['Mary Jane Watson', 'MW'], ['', '?'], ['李 明', '李明']])('derives initials for %s', (name, initials) => {
    expect(initialsFor(name)).toBe(initials)
  })

  it('uses initials and character color without an icon', () => {
    const html = renderToStaticMarkup(createElement(InitialsAvatar, { name: 'Parisa Farzaneh', color: '#654578' }))
    expect(html).toContain('PF')
    expect(html).toContain('#654578')
    expect(html).not.toContain('<img')
  })

  it('renders the supplied authorized image', () => {
    const html = renderToStaticMarkup(createElement(InitialsAvatar, { name: 'Parisa Farzaneh', imageUrl: '/api/characters/parisa/icon' }))
    expect(html).toContain('src="/api/characters/parisa/icon"')
    expect(html).toContain('alt="Parisa Farzaneh"')
  })
})
