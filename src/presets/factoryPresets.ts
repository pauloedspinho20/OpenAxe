/**
 * Bundled starter presets. FX-only (no modelId/irId) - we don't bundle any
 * third-party .nam/IR files (see the effects suite's licensing note for the
 * same reasoning applied to sample audio content instead of code), so a
 * factory pack that recommends specific amp models isn't possible yet. Once
 * Tone3000 integration exists, presets that also reference a specific model
 * become a reasonable addition alongside these.
 *
 * Each preset lays out N parallel effect chains (one per row), all fed from
 * IN, merged through a Mixer before OUT - the flat-graph equivalent of the
 * old fixed dual-chain rig's two independently-processed sides.
 */
import { getPreset, savePreset } from './presetStore'
import { IN_RAIL, OUT_RAIL } from '../engine/gridConfig'
import type { EffectKind } from '../effects/Effect'
import type { EffectParams } from '../engine/blocks/Block'
import type { Preset, PresetBlockData, PresetEdgeData } from './types'

interface RowEffect {
  kind: EffectKind
  params: EffectParams
}

function drive(overrides: Partial<EffectParams> = {}): RowEffect {
  return {
    kind: 'drive',
    params: { type: 'overdrive', drive: 0.4, tone: 8000, level: 0.7, ...overrides },
  }
}

function compressor(): RowEffect {
  return {
    kind: 'compressor',
    params: { threshold: -24, knee: 6, ratio: 3, attack: 0.01, release: 0.2 },
  }
}

function eq(): RowEffect {
  return {
    kind: 'eq',
    params: {
      bandCount: 4,
      band0_frequency: 100,
      band0_gain: 0,
      band0_q: 1,
      band1_frequency: 500,
      band1_gain: 0,
      band1_q: 1,
      band2_frequency: 2000,
      band2_gain: 2,
      band2_q: 1,
      band3_frequency: 6000,
      band3_gain: 1,
      band3_q: 1,
    },
  }
}

function chorus(): RowEffect {
  return { kind: 'chorus', params: { rate: 1.2, depth: 4, feedback: 0.15 } }
}

function tapeDelay(): RowEffect {
  return { kind: 'delay', params: { character: 'tape', time: 0.35, feedback: 0.35, tone: 3500 } }
}

function reverb(roomSize: number): RowEffect {
  return { kind: 'reverb', params: { roomSize, damping: 0.5 } }
}

/** Lay out parallel rows of effects (IN -> row's effects in series -> Mixer -> OUT). */
function buildFactoryPreset(id: string, name: string, rows: RowEffect[][]): Preset {
  const blocks: PresetBlockData[] = []
  const edges: PresetEdgeData[] = []
  let nextId = 0
  const genId = (prefix: string) => `${prefix}${++nextId}`

  const rowEndpoints = rows.map((rowEffects, row) => {
    let previousId: string = IN_RAIL
    let col = 0
    for (const effect of rowEffects) {
      const blockId = genId('b')
      blocks.push({
        id: blockId,
        kind: effect.kind,
        row,
        col,
        bypass: false,
        params: effect.params,
      })
      edges.push({
        id: genId('e'),
        from: { blockId: previousId, port: 0 },
        to: { blockId, port: 0 },
      })
      previousId = blockId
      col += 1
    }
    return { endpointId: previousId, col }
  })

  const mixerCol = Math.max(1, ...rowEndpoints.map((r) => r.col))
  const mixerId = genId('b')
  blocks.push({ id: mixerId, kind: 'mixer', row: 0, col: mixerCol, params: {} })

  rowEndpoints.forEach(({ endpointId }, row) => {
    edges.push({
      id: genId('e'),
      from: { blockId: endpointId, port: 0 },
      to: { blockId: mixerId, port: row },
    })
  })
  edges.push({
    id: genId('e'),
    from: { blockId: mixerId, port: 0 },
    to: { blockId: OUT_RAIL, port: 0 },
  })

  return {
    id,
    name,
    tags: ['factory'],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks,
    edges,
    masterLevel: 1,
    masterMuted: false,
  }
}

export const FACTORY_PRESETS: readonly Preset[] = [
  buildFactoryPreset('factory-clean-boost', 'Clean Boost', [
    [compressor(), eq()],
    [compressor(), eq()],
  ]),
  buildFactoryPreset('factory-bedroom-overdrive', 'Bedroom Overdrive', [
    [drive(), tapeDelay()],
    [drive({ drive: 0.3 })],
  ]),
  buildFactoryPreset('factory-ambient-swell', 'Ambient Swell', [
    [chorus(), reverb(0.7)],
    [tapeDelay(), reverb(0.7)],
  ]),
]

/**
 * Save every factory preset that isn't already saved (by id) - never
 * overwrites a user's edits to a factory preset they've customized.
 */
export async function installFactoryPresets(): Promise<void> {
  for (const preset of FACTORY_PRESETS) {
    const existing = await getPreset(preset.id)
    if (!existing) await savePreset(preset)
  }
}
