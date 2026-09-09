import { PALETTE_BLOCK_KINDS } from '../../effects/generatedBlockConfig'
import type { BlockKind } from '../../engine/blocks/Block'

export interface BlockOption {
  kind: BlockKind
  label: string
  group: 'Core' | 'Effects' | 'Neural Amp Modeler'
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
 * AddBlockMenu, BlockPalette, and BlockCard's labels all read from. The three
 * "Neural Amp Modeler" kinds are named after Tone3000's own gear categories
 * exactly (see engine/blocks/Block.ts) so each one browses Tone3000
 * pre-filtered to its own gear type; Cab is grouped there too (it is the
 * amplifier's speaker, even though it loads an IR rather than a NAM capture).
 * "Core" holds the pure-routing blocks - the Mixer and the Send/Return
 * relay pairs (issue #274).
 */
const ALL_BLOCK_OPTIONS: BlockOption[] = [
  {
    kind: 'pedal',
    label: 'Pedal',
    group: 'Neural Amp Modeler',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'amp',
    label: 'Amp',
    group: 'Neural Amp Modeler',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'amp-cab',
    label: 'Amp/Cab',
    group: 'Neural Amp Modeler',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  {
    kind: 'cab',
    label: 'Cab',
    group: 'Neural Amp Modeler',
    vendor: 'Web Audio ConvolverNode (native)',
  },
  /*   {
    kind: 'space',
    label: 'Space',
    group: 'Neural Amp Modeler',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  }, */
  {
    kind: 'outboard',
    label: 'Outboard',
    group: 'Neural Amp Modeler',
    vendor: 'Neural Amp Modeler',
    vendorUrl: 'https://github.com/sdatkinson/neural-amp-modeler',
  },
  { kind: 'mixer', label: 'Mixer', group: 'Core', vendor: 'Native routing (no DSP)' },
  {
    kind: 'send-1',
    label: 'Send 1',
    group: 'Core',
    vendor: 'Native routing (no DSP)',
  },
  {
    kind: 'send-2',
    label: 'Send 2',
    group: 'Core',
    vendor: 'Native routing (no DSP)',
  },
  {
    kind: 'return-1',
    label: 'Return 1',
    group: 'Core',
    vendor: 'Native routing (no DSP)',
  },
  {
    kind: 'return-2',
    label: 'Return 2',
    group: 'Core',
    vendor: 'Native routing (no DSP)',
  },
  {
    kind: 'delay',
    label: 'Delay',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'reverb',
    label: 'Reverb',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'noise-gate',
    label: 'Gate',
    group: 'Effects',
    vendor: 'DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'compressor',
    label: 'Comp',
    group: 'Effects',
    vendor: 'DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'eq',
    label: 'EQ',
    group: 'Core',
    vendor: 'DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'chorus',
    label: 'Chorus',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'flanger',
    label: 'Flanger',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'phaser',
    label: 'Phaser',
    group: 'Effects',
    // Voiced as an MXR Phase 90 (issue #317): dspark::Phaser fixed to 4
    // stages, triangle LFO, 200 Hz-2.8 kHz sweep, mono, with the EVH
    // pedal's Script/Block feedback voices. Two knobs on purpose - the
    // fixed voicing is the sound.
    vendor: 'DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  },
  {
    kind: 'tremolo',
    label: 'Tremolo',
    group: 'Effects',
    // Hand-rolled in packages/core, not DSPark - tremolo.cpp includes only
    // internal/biquad.h. It stays that way: #319 looked at migrating to
    // dspark::Tremolo and found it buys nothing here - the same three shapes,
    // the same 2% slew on the square, and no access to the LFO phase that
    // harmonic mode needs.
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'ring-mod',
    label: 'Ring Mod',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'filter',
    label: 'Filter',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  {
    kind: 'pitch-shifter',
    label: 'Pitch',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
  /*  {
    kind: 'granular-delay',
    label: 'Granular Delay',
    group: 'Effects',
    // The grain engine is dspark::GranularProcessor; the delay line, feedback,
    // cross-feed and `character` colouring around it are packages/core.
    vendor: 'DSPark',
    vendorUrl: 'https://github.com/CristianMoresi/DSPark',
  }, */
  {
    kind: 'rotary',
    label: 'Rotary',
    group: 'Effects',
    vendor: 'packages/core (C++ WASM)',
    vendorUrl: 'https://github.com/pauloedspinho20/OpenAxe/tree/main/packages/core',
  },
]

/**
 * What the palette actually offers: every kind above whose `inPalette` flag is
 * set in packages/core/effects.config.json (issue #313). Withholding a kind
 * used to mean commenting its entry out here, which lost its label and vendor
 * too and left the DSP compiled into every binary regardless. The config owns
 * that decision now, so this file stays the presentation data for *every*
 * kind - a block restored from a preset still resolves a label even when the
 * palette does not offer it.
 */
export const BLOCK_OPTIONS: BlockOption[] = ALL_BLOCK_OPTIONS.filter((o) =>
  PALETTE_BLOCK_KINDS.has(o.kind),
)

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = Object.fromEntries(
  ALL_BLOCK_OPTIONS.map((o) => [o.kind, o.label]),
) as Record<BlockKind, string>

export const BLOCK_KIND_VENDORS: Record<BlockKind, string> = Object.fromEntries(
  ALL_BLOCK_OPTIONS.map((o) => [o.kind, o.vendor]),
) as Record<BlockKind, string>

export const BLOCK_KIND_VENDOR_URLS: Record<BlockKind, string | undefined> = Object.fromEntries(
  ALL_BLOCK_OPTIONS.map((o) => [o.kind, o.vendorUrl]),
) as Record<BlockKind, string | undefined>
