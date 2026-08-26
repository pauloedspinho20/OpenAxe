/**
 * The curated factory pack: a metadata-only manifest of Tone3000 tones the
 * maintainer curates (amp / amp-cab / pedal / cab-IR captures) plus the
 * presets that reference them. No model files are ever bundled - each model
 * is downloaded through the user's own authenticated Tone3000 account at
 * first-run time (see factory/factoryDownload.ts), with creator/source/url
 * attribution recorded, per the Tone3000 partner terms.
 *
 * Curation: add tone ids + model references to `FACTORY_PACK.models`, define
 * presets that use them, and list which bank slots scene 0 should reference.
 * `models` and `presets` are currently empty until curated - the factory
 * dialog's "Download" path degrades to a clear message in that case.
 */
import { IN_RAIL, OUT_RAIL } from '../engine/gridConfig'
import type { NamModelBlockKind } from '../engine/blocks/AmpBlock'
import type { Tone3000Slot } from '../tone3000/types'
import type { Preset, PresetBlockData, PresetEdgeData } from '../presets/types'

export interface FactoryPackModel {
  /** Curated Tone3000 tone id. */
  toneId: number
  /** Which rack slot the model loads into. */
  slot: Tone3000Slot
  /** Optional: pin a specific model variant id from the tone; defaults to the first model returned. */
  modelId?: number
  /** Curated display name (usually the tone title). */
  name: string
}

export interface FactoryPackBlock {
  /** Index into FACTORY_PACK.models. */
  modelRef: number
  /** NAM model kinds all load a .nam capture; pick the closest to the captured gear. */
  kind: NamModelBlockKind
}

export interface FactoryPackPreset {
  id: string
  name: string
  /** Preset-bank slot (0-511) to place this preset into. */
  bankSlot: number
  /** Amp/NAM blocks, each referencing a pack model. */
  blocks: FactoryPackBlock[]
  /** Optional cab block - an index into FACTORY_PACK.models whose slot === 'ir'. */
  irRef?: number
}

export interface FactoryPack {
  models: FactoryPackModel[]
  presets: FactoryPackPreset[]
  /** Bank slots scene 0's 8 slots should reference (max SLOTS_PER_SCENE entries). */
  scene0Slots: number[]
}

export const FACTORY_PACK: FactoryPack = {
  models: [
    { toneId: 65578, slot: 'model', name: 'Marshall JMP-50 Lead 1969 Plexi A2' },
    { toneId: 84862, slot: 'model', name: '5150 Stealth 100w Preamp - Blue, Red and Green' },
  ],
  presets: [
    {
      id: 'factory-lead',
      name: 'Lead',
      bankSlot: 0, // where it lands in the 512-slot bank
      blocks: [{ modelRef: 0, kind: 'amp-cab' }], // modelRef 0 = models[0]
      //  irRef: 2, // optional cab block → models[2]
    },
    {
      id: 'factory-metal',
      name: 'Metal',
      bankSlot: 1, // where it lands in the 512-slot bank
      blocks: [{ modelRef: 1, kind: 'amp-cab' }], // modelRef 0 = models[0]
      // irRef: 2, // optional cab block → models[2]
    },
    /*  {
      id: 'factory-5150-lead',
      name: '5150 Lead',
      bankSlot: 0, // where it lands in the 512-slot bank
      blocks: [{ modelRef: 0, kind: 'amp-cab' }], // modelRef 0 = models[0]
      irRef: 2, // optional cab block → models[2]
    }, */
  ],
  scene0Slots: [0, 1],
}

/** A pack model that resolved to a downloadable/cached library asset. */
export interface ResolvedPackModel {
  assetId: string
  name: string
}

/**
 * Builds a Preset from a pack definition, wiring IN -> amp (and optional cab)
 * -> OUT. Returns null if any referenced model failed to download - the
 * preset can't be "ready to use" without its asset, so it's skipped.
 */
export function buildPackPreset(
  def: FactoryPackPreset,
  resolved: ReadonlyMap<number, ResolvedPackModel>,
): Preset | null {
  const blocks: PresetBlockData[] = []
  const edges: PresetEdgeData[] = []
  let nextId = 0
  const genId = (prefix: string) => `${prefix}${++nextId}`

  let previousId: string = IN_RAIL
  let col = 0
  for (const block of def.blocks) {
    const model = resolved.get(block.modelRef)
    if (!model) return null
    const blockId = genId('b')
    blocks.push({
      id: blockId,
      kind: block.kind,
      row: 0,
      col,
      params: {},
      modelId: model.assetId,
      modelName: model.name,
    })
    edges.push({
      id: genId('e'),
      from: { blockId: previousId, port: 0 },
      to: { blockId, port: 0 },
    })
    previousId = blockId
    col += 1
  }

  if (def.irRef != null) {
    const ir = resolved.get(def.irRef)
    if (!ir) return null
    const cabId = genId('b')
    blocks.push({
      id: cabId,
      kind: 'cab',
      row: 0,
      col,
      params: {},
      irId: ir.assetId,
      irName: ir.name,
    })
    edges.push({
      id: genId('e'),
      from: { blockId: previousId, port: 0 },
      to: { blockId: cabId, port: 0 },
    })
    previousId = cabId
    col += 1
  }

  edges.push({
    id: genId('e'),
    from: { blockId: previousId, port: 0 },
    to: { blockId: OUT_RAIL, port: 0 },
  })

  return {
    id: def.id,
    name: def.name,
    tags: ['factory'],
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    blocks,
    edges,
    masterLevel: 1,
    masterMuted: false,
  }
}
