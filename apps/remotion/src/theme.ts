import { z } from 'zod'

export const themeSchema = z.enum(['carbon', 'aluminum'])
export type Theme = z.infer<typeof themeSchema>

// Mirrors packages/ui/tokens/design-tokens.json — single source, no hardcoded drift
export const tokens = {
  dark: {
    chassis: '#101010',
    panel: '#1a1a1a',
    panelRaised: '#212121',
    panelRecessed: '#171613',
    seam: 'rgb(255 255 255 / 6%)',
    seamStrong: 'rgb(255 255 255 / 12%)',
    ink1: '#eeece6',
    ink2: '#8f8d86',
    ink3: '#57564f',
    accent: '#ff5a1f',
    accentDim: 'rgb(255 90 31 / 16%)',
    accentInk: '#1a0900',
    ledOn: '#5fdc7a',
    ledWarn: '#ffb020',
    ledHot: '#ff3b30',
    ledOff: '#2a2a28',
    screenBg: '#06070a',
    screenText: '#5fdc7a',
    screenDim: '#3a3f38',
    blockNam: '#ff8a3d',
    blockMod: '#7ab8ff',
    blockTime: '#a78bfa',
    blockSpace: '#5fdc7a',
    blockFilter: '#4ec9a6',
    blockDynamics: '#e8c547',
    blockUtility: '#9aa0a6',
  },
  light: {
    chassis: '#e7e2d6',
    panel: '#efeae0',
    panelRaised: '#f7f3ea',
    panelRecessed: '#d9d3c4',
    seam: 'rgb(0 0 0 / 8%)',
    seamStrong: 'rgb(0 0 0 / 16%)',
    ink1: '#201f1a',
    ink2: '#6b6a62',
    ink3: '#a6a297',
    accent: '#ff5a1f',
    accentDim: 'rgb(255 90 31 / 16%)',
    accentInk: '#1a0900',
    ledOn: '#5fdc7a',
    ledWarn: '#ffb020',
    ledHot: '#ff3b30',
    ledOff: '#2a2a28',
    screenBg: '#06070a',
    screenText: '#5fdc7a',
    screenDim: '#3a3f38',
    blockNam: '#ff8a3d',
    blockMod: '#7ab8ff',
    blockTime: '#a78bfa',
    blockSpace: '#5fdc7a',
    blockFilter: '#4ec9a6',
    blockDynamics: '#e8c547',
    blockUtility: '#9aa0a6',
  },
} as const

export function getTheme(theme: Theme) {
  return theme === 'carbon' ? tokens.dark : tokens.light
}

export const fontDisplay = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
export const fontBody = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
