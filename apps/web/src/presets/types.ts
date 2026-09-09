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
  /**
   * Cache transfer for gapless adoption (issue #367): after a staged commit
   * the live facade is rebuilt around the new engine, and these carry the
   * already-live values over without re-sending them to the worklet.
   */
  snapshotBlockState?(): {
    params: EffectParams
    bypassed: boolean
    loadedModel: { id: string; name: string } | null
    loadedIr: { id: string; name: string } | null
  }
  restoreBlockState?(snapshot: {
    params: EffectParams
    bypassed: boolean
    loadedModel: { id: string; name: string } | null
    loadedIr: { id: string; name: string } | null
  }): void
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

/**
 * Staged-build surface for gapless preset switching (issue #367): a rig
 * under construction on the worklet's staged graph, crossfaded live by
 * commit. GraphRig's StagedRig implements this; mock rigs in tests don't
 * have to (applyPreset falls back to the teardown-and-rebuild path).
 */
export interface StagedBlockSnapshot {
  block: PresetBlock
  kind: BlockKind
  row: number
  col: number
}

export interface StagedEdgeSnapshot {
  from: Jack
  to: Jack
}

export interface StagedPresetRig {
  getBlock(id: string): PresetBlock | null
  addBlock(kind: BlockKind, row: number, col: number, id: string): Promise<string>
  /** Connect awaited against the core (unlike PresetRig's fire-and-forget). */
  connectAndWait(from: Jack, to: Jack, id: string): Promise<{ ok: boolean; reason?: string }>
  /** Crossfade the staged rig live (retries while a previous switch drains). */
  commit(): Promise<void>
  /** Abandon the staged build. */
  discard(): Promise<void>
  /**
   * Hand the staged bookkeeping over after a successful commit. Only valid
   * once commit() resolved - the live core graph IS the staged engine now.
   */
  takeEntries(): {
    blocks: Map<string, StagedBlockSnapshot>
    edges: Map<string, StagedEdgeSnapshot>
  }
}

/** A PresetRig that can build the next preset on a staged graph. */
export interface StageCapableRig extends PresetRig {
  beginStage(): Promise<StagedPresetRig>
  adoptStage(staged: StagedPresetRig): void
}
