import type { BlockKind } from '../../engine/blocks/Block'

/**
 * One color per palette group (Core vs Effects) — as requested.
 * Core (amps/cabs + routing) shares one token, Effects share the other.
 * Keeps the 8 semantic tokens around for future use, but the live mapping
 * is intentionally just two.
 */
type PaletteGroup = 'NAM' | 'Core' | 'Effects'

const NAM_KINDS = new Set<BlockKind>(['amp', 'amp-cab', 'cab', 'pedal', 'outboard', 'space'])

const CORE_KINDS = new Set<BlockKind>(['mixer', 'send-1', 'send-2', 'return-1', 'return-2'])

function paletteGroupForKind(kind: BlockKind): PaletteGroup {
  if (NAM_KINDS.has(kind)) return 'NAM'
  if (CORE_KINDS.has(kind)) return 'Core'
  return 'Effects'
}

const PALETTE_GROUP_TO_CSS_VAR: Record<PaletteGroup, string> = {
  NAM: '--block-nam',
  Core: '--block-core',
  Effects: '--block-effects',
}

export function blockColorVar(kind: BlockKind): string {
  return `var(${PALETTE_GROUP_TO_CSS_VAR[paletteGroupForKind(kind)]})`
}

export function blockGroupForKind(kind: BlockKind): PaletteGroup {
  return paletteGroupForKind(kind)
}

// Keep semantic group mapping available if needed later (not used live).
export type BlockSemanticGroup =
  | 'blockTone'
  | 'blockDrive'
  | 'blockDynamics'
  | 'blockFilter'
  | 'blockMod'
  | 'blockTime'
  | 'blockSpace'
  | 'blockUtility'
