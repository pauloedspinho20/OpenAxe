import type { BlockKind } from '../../engine/blocks/Block'

/**
 * One color per palette group (Core vs Effects) — as requested.
 * Core (amps/cabs + routing) shares one token, Effects share the other.
 * Keeps the 8 semantic tokens around for future use, but the live mapping
 * is intentionally just two.
 */
type PaletteGroup =
  | 'amp'
  | 'amp-cab'
  | 'pedal'
  | 'cab'
  | 'filter'
  | 'utility'
  | 'delay'
  | 'reverb'
  | 'modulation'
  | 'core'
  | 'dynamics'

function paletteGroupForKind(kind: BlockKind): PaletteGroup {
  switch (kind) {
    case 'amp':
      return 'amp'
    case 'amp-cab':
      return 'amp-cab'
    case 'cab':
      return 'cab'
    case 'pedal':
      return 'pedal'
    case 'filter':
      return 'filter'
    case 'mixer':
      return 'utility'
    case 'send-1':
      return 'utility'
    case 'send-2':
      return 'utility'
    case 'return-1':
      return 'utility'
    case 'return-2':
      return 'utility'
    case 'delay':
      return 'delay'
    case 'reverb':
      return 'reverb'
    case 'chorus':
      return 'modulation'
    case 'flanger':
      return 'modulation'
    case 'phaser':
      return 'modulation'
    case 'tremolo':
      return 'modulation'
    case 'ring-mod':
      return 'modulation'
    case 'pitch-shifter':
      return 'modulation'
    case 'granular-delay':
      return 'modulation'
    case 'rotary':
      return 'modulation'
    case 'compressor':
      return 'dynamics'
    case 'noise-gate':
      return 'dynamics'
    default:
      return 'utility'
  }
}

const PALETTE_GROUP_TO_CSS_VAR: Record<PaletteGroup, string> = {
  amp: '--block-amp',
  'amp-cab': '--block-amp-cab',
  pedal: '--block-pedal',
  cab: '--block-cab',
  filter: '--block-filter',
  utility: '--block-utility',
  delay: '--block-delay',
  reverb: '--block-reverb',
  modulation: '--block-modulation',
  core: '--block-core',
  dynamics: '--block-dynamics',
}

export function blockColorVar(kind: BlockKind): string {
  return `var(${PALETTE_GROUP_TO_CSS_VAR[paletteGroupForKind(kind)]})`
}

export function blockGroupForKind(kind: BlockKind): PaletteGroup {
  return paletteGroupForKind(kind)
}
