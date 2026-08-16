import type { BlockKind } from '../../engine/blocks/Block'

export interface BlockOption {
  kind: BlockKind
  label: string
  group: 'Core' | 'Effects'
  /**
   * The real DSP/routing this block kind runs on today, shown in
   * BlockInspector so it's always clear which blocks run the new
   * packages/core C++ DSP core vs. a pre-existing engine vs. plain Web
   * Audio routing.
   */
  vendor: string
  /**
   * The URL to the vendor's website.
   */
  vendorUrl?: string
  /**
   * True for effect kinds still on their original hand-rolled Web Audio
   * implementation, awaiting migration to packages/core (see issue #22) -
   * not placeable yet (BlockPalette/AddBlockMenu both disable these) so a
   * user can't mistake them for already-migrated DSP. Re-enable each one as
   * its packages/core wrapper lands and gets wired into the web app.
   */
  disabled?: boolean
}

/**
 * Canonical list of every placeable block kind - the single source
 * AddBlockMenu, BlockPalette, and BlockCard's labels all read from. The 6
 * "Core" kinds are named after Tone3000's own gear categories exactly (see
 * engine/blocks/Block.ts) so each one browses Tone3000 pre-filtered to its
 * own gear type.
 */
export const BLOCK_OPTIONS: BlockOption[] = [
  {
    kind: 'amp',
    label: 'Amp',
    group: 'Core',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'amp-cab',
    label: 'Amp+Cab',
    group: 'Core',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  { kind: 'cab', label: 'Cab', group: 'Core', vendor: 'Web Audio ConvolverNode (native)' },
  {
    kind: 'pedal',
    label: 'Pedal',
    group: 'Core',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'outboard',
    label: 'Outboard',
    group: 'Core',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'space',
    label: 'Space',
    group: 'Core',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  { kind: 'mixer', label: 'Mixer', group: 'Core', vendor: 'Native routing (no DSP)' },
  { kind: 'splitter', label: 'Splitter', group: 'Core', vendor: 'Native routing (no DSP)' },
  {
    kind: 'noise-gate',
    label: 'Noise Gate',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM) — DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'compressor',
    label: 'Compressor',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM) — DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'eq',
    label: 'EQ',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM) — DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'chorus',
    label: 'Chorus',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
  },
  {
    kind: 'flanger',
    label: 'Flanger',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
  },
  {
    kind: 'phaser',
    label: 'Phaser',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
  },
  {
    kind: 'tremolo',
    label: 'Tremolo',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM) — DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'delay',
    label: 'Delay',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
  },
  {
    kind: 'ping-pong-delay',
    label: 'Ping-Pong Delay',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
  },
  {
    kind: 'reverb',
    label: 'Reverb',
    group: 'Effects',
    vendor: 'Dragonfly Reverb',
    vendorUrl: 'https://github.com/michaelwillis/dragonfly-reverb',
  },
  {
    kind: 'drive',
    label: 'Drive',
    group: 'Effects',
    vendor: 'BYOD',
    vendorUrl: 'https://github.com/Chowdhury-DSP/BYOD',
  },
]

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = Object.fromEntries(
  BLOCK_OPTIONS.map((o) => [o.kind, o.label]),
) as Record<BlockKind, string>

export const BLOCK_KIND_VENDORS: Record<BlockKind, string> = Object.fromEntries(
  BLOCK_OPTIONS.map((o) => [o.kind, o.vendor]),
) as Record<BlockKind, string>

export const BLOCK_KIND_VENDOR_URLS: Record<BlockKind, string | undefined> = Object.fromEntries(
  BLOCK_OPTIONS.map((o) => [o.kind, o.vendorUrl]),
) as Record<BlockKind, string | undefined>
