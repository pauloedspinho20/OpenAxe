// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readThemeColors, type ThemeColors } from './theme'

const FALLBACK: ThemeColors = {
  screen: '#171613',
  ink1: '#eeece6',
  ink2: '#8f8d86',
  ink3: '#57564f',
  accent: '#ff5a1f',
  ledOn: '#5fdc7a',
  ledWarn: '#ffb020',
  ledHot: '#ff3b30',
  seam: 'rgba(255, 255, 255, 0.12)',
}

const ALL_KEYS: (keyof ThemeColors)[] = [
  'screen',
  'ink1',
  'ink2',
  'ink3',
  'accent',
  'ledOn',
  'ledWarn',
  'ledHot',
  'seam',
]

describe('readThemeColors', () => {
  it('returns all nine color slots', () => {
    const colors = readThemeColors()
    for (const key of ALL_KEYS) {
      expect(colors[key]).toBeDefined()
    }
  })

  it('falls back to hardcoded values when no CSS custom properties are set', () => {
    const colors = readThemeColors()
    expect(colors).toEqual(FALLBACK)
  })

  it('reads an overridden custom property from :root', () => {
    document.documentElement.style.setProperty('--accent', '#123456')
    expect(readThemeColors().accent).toBe('#123456')
    document.documentElement.style.removeProperty('--accent')
  })
})
