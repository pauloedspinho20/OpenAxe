import type { BlockKind, EffectParams } from '../engine/blocks/Block'
import type { Jack } from '../engine/gridConfig'

export interface PresetBlockData {
  id: string
  kind: BlockKind
  row: number
  col: number
  /** Meaningful for the 11 effect kinds and the 5 NAM model kinds - Cab/Tone Stack/Mixer have no bypass concept. */
  bypass?: boolean
  params: EffectParams
  /** Amp blocks only - reference into the local asset cache (see assetCache.ts). */
  modelId?: string | null
  modelName?: string | null
  /** Cab blocks only. */
  irId?: string | null
  irName?: string | null
}

export interface PresetEdgeData {
  id: string
  from: Jack
  to: Jack
}

export interface Preset {
  id: string
  name: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  blocks: PresetBlockData[]
  edges: PresetEdgeData[]
  masterLevel: number
  masterMuted: boolean
}

/**
 * The narrow slice of a live block capture/apply need. The "extra" methods
 * are all optional: only Amp/Cab blocks have asset methods, only the 11
 * effect kinds and the 5 NAM model kinds have bypass - callers duck-type
 * check before use, the same pattern EffectParamsPanel/BlockCard already
 * use elsewhere in the app.
 */
export interface PresetBlock {
  readonly kind: BlockKind
  getParams(): EffectParams
  setParams(params: EffectParams): void
  isBypassed?(): boolean
  setBypass?(bypassed: boolean): void
  getLoadedModel?(): { id: string; name: string } | null
  loadModel?(
    json: string,
    slimSize: number | undefined,
    info: { id: string; name: string },
  ): Promise<unknown>
  unloadModel?(): Promise<void>
  getLoadedIr?(): { id: string; name: string } | null
  loadIR?(buffer: AudioBuffer, mix: number, info: { id: string; name: string }): void
  clearIR?(): void
}

/**
 * The narrow slice of GraphRig that capture/apply need. Declared separately
 * (rather than importing GraphRig directly) so tests can pass a plain mock
 * instead of standing up a real AudioContext - same reasoning as
 * bindGraphRig's GraphRigControls.
 */
export interface PresetRig {
  listBlockIds(): string[]
  getBlock(id: string): PresetBlock | null
  addBlock(kind: BlockKind, row: number, col: number, id?: string): Promise<string>
  removeBlock(id: string): Promise<void>
  listEdgeIds(): string[]
  connect(from: Jack, to: Jack, id?: string): { ok: boolean; reason?: string }
}
