/**
 * Reads the app's live CSS custom properties so the p5 art can match
 * whichever hardware finish (Carbon/dark or Aluminum/light) is currently
 * active. There's no theme context or change event (see useTheme.ts) - the
 * sketch just re-reads these periodically, which is cheap and always
 * reflects the true current state regardless of which component toggled it.
 */
export interface ThemeColors {
  screen: string
  ink1: string
  ink2: string
  ink3: string
  accent: string
  ledOn: string
  ledWarn: string
  ledHot: string
  seam: string
}

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

export function readThemeColors(): ThemeColors {
  if (typeof window === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    screen: read('--panel-recessed', FALLBACK.screen),
    ink1: read('--ink-1', FALLBACK.ink1),
    ink2: read('--ink-2', FALLBACK.ink2),
    ink3: read('--ink-3', FALLBACK.ink3),
    accent: read('--accent', FALLBACK.accent),
    ledOn: read('--led-on', FALLBACK.ledOn),
    ledWarn: read('--led-warn', FALLBACK.ledWarn),
    ledHot: read('--led-hot', FALLBACK.ledHot),
    seam: read('--seam-strong', FALLBACK.seam),
  }
}
