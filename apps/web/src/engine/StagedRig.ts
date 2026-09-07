import type { BlockKind } from './blocks/Block'
import type { Jack } from './gridConfig'
import { canConnect, type ValidatableBlock } from './graphValidation'
import { RigBlock } from './RigBlock'
import {
  type RigBlockPort,
  type RigConnectResult,
  type RigModelInfo,
  type RigWorkletNode,
} from './RigWorkletNode'
import type { StagedEdgeSnapshot, StagedBlockSnapshot, StagedPresetRig } from '../presets/types'

/** Fade/drain defaults for a preset switch (see openaxe_staged_graph_commit). */
export const STAGE_COMMIT_FADE_MS = 25
export const STAGE_COMMIT_DRAIN_MS = 500
/** How long commit retries while a previous switch is still draining. */
const COMMIT_BUSY_TIMEOUT_MS = 3000
const COMMIT_BUSY_POLL_MS = 25

/**
 * RigBlockPort over the staged graph: every write carries `stage: true` so
 * the same RigBlock code that drives the live rig builds the staged one
 * (issue #367).
 */
class StagedWorkletPort implements RigBlockPort {
  private readonly worklet: RigWorkletNode

  constructor(worklet: RigWorkletNode) {
    this.worklet = worklet
  }

  setParam(blockId: string, key: string, value: number): void {
    this.worklet.setParamStaged(blockId, key, value)
  }

  setBypass(blockId: string, bypassed: boolean): void {
    this.worklet.setBypassStaged(blockId, bypassed)
  }

  setReverbAlgorithm(blockId: string, algorithm: string): void {
    this.worklet.setReverbAlgorithmStaged(blockId, algorithm)
  }

  setTrim(blockId: string, input?: number, output?: number): void {
    this.worklet.setTrimStaged(blockId, input, output)
  }

  loadModel(blockId: string, json: string, slimSize?: number): Promise<RigModelInfo> {
    return this.worklet.loadModelStaged(blockId, json, slimSize)
  }

  unloadModel(blockId: string): Promise<void> {
    return this.worklet.unloadModelStaged(blockId)
  }

  setSlimSize(blockId: string, slimSize: number): Promise<void> {
    return this.worklet.setSlimSizeStaged(blockId, slimSize)
  }

  loadIr(blockId: string, samples: Float32Array): Promise<void> {
    return this.worklet.loadIrStaged(blockId, samples)
  }

  unloadIr(blockId: string): Promise<void> {
    return this.worklet.unloadIrStaged(blockId)
  }
}

export interface StagedBlockEntry {
  block: RigBlock
  kind: BlockKind
  row: number
  col: number
}

export interface StagedEdge {
  readonly from: Jack
  readonly to: Jack
}

/**
 * Builder for the next rig on the worklet's staged graph (issue #367).
 * Mirrors the slice of GraphRig that preset apply needs - addBlock/getBlock/
 * connect - but targets the staged graph, then crossfades it live with
 * commit(). A failed build must discard() so the staged graph never leaks;
 * GraphRig.adoptStage takes over the bookkeeping after a successful commit.
 */
export class StagedRig implements StagedPresetRig {
  private readonly worklet: RigWorkletNode
  private readonly port: StagedWorkletPort
  private readonly blocks = new Map<string, StagedBlockEntry>()
  private readonly edges = new Map<string, StagedEdge>()
  private settled = false

  private constructor(worklet: RigWorkletNode) {
    this.worklet = worklet
    this.port = new StagedWorkletPort(worklet)
  }

  /** Open a staged graph on the worklet. Throws when the WASM is too old. */
  static async begin(worklet: RigWorkletNode): Promise<StagedRig> {
    await worklet.stageBegin()
    return new StagedRig(worklet)
  }

  async addBlock(kind: BlockKind, row: number, col: number, id: string): Promise<string> {
    this.assertOpen()
    await this.worklet.addBlockStaged(id, kind, row, col)
    this.blocks.set(id, { block: new RigBlock(this.port, id, kind), kind, row, col })
    return id
  }

  getBlock(id: string): RigBlock | null {
    return this.blocks.get(id)?.block ?? null
  }

  listBlockIds(): string[] {
    return [...this.blocks.keys()]
  }

  /**
   * Connect two staged blocks, validated locally first (same rules as the
   * live rig) and awaited against the core so a rejection is known before
   * the commit - unlike the live rig's fire-and-forget connect.
   */
  async connectAndWait(from: Jack, to: Jack, id: string): Promise<RigConnectResult> {
    this.assertOpen()
    const blocks = new Map<string, ValidatableBlock>()
    for (const [blockId, entry] of this.blocks) {
      blocks.set(blockId, { id: blockId, kind: entry.kind, col: entry.col })
    }
    const valid = canConnect(blocks, this.edges.values(), from, to)
    if (!valid.ok) return valid
    const reply = await this.worklet.connectStaged(from, to, id)
    if (!reply.ok) return reply
    this.edges.set(id, { from, to })
    return { ok: true }
  }

  /**
   * Crossfade the staged rig live, retrying while a previous switch is still
   * draining. On success the StagedRig is settled (its maps are ready for
   * GraphRig.adoptStage); on failure the caller should discard().
   */
  async commit(fadeMs = STAGE_COMMIT_FADE_MS, drainMs = STAGE_COMMIT_DRAIN_MS): Promise<void> {
    this.assertOpen()
    const deadline = Date.now() + COMMIT_BUSY_TIMEOUT_MS
    for (;;) {
      const result = await this.worklet.stageCommit(fadeMs, drainMs)
      if (result === 'committed') {
        this.settled = true
        return
      }
      if (Date.now() >= deadline) {
        throw new Error('stageCommit stayed busy: a previous switch never drained')
      }
      await new Promise((resolve) => setTimeout(resolve, COMMIT_BUSY_POLL_MS))
    }
  }

  /** Abandon the staged build. Safe to call after commit too (no-op). */
  async discard(): Promise<void> {
    if (this.settled) return
    this.settled = true
    await this.worklet.stageDiscard()
  }

  /**
   * Hand the staged bookkeeping to the live rig after a successful commit.
   * Only valid once commit() resolved - the live core graph IS the staged
   * engine now, so these maps describe it exactly.
   */
  takeEntries(): {
    blocks: Map<string, StagedBlockSnapshot>
    edges: Map<string, StagedEdgeSnapshot>
  } {
    if (!this.settled) throw new Error('takeEntries before a successful commit')
    // Re-map into interface-typed containers (Map is invariant in TS).
    return {
      blocks: new Map<string, StagedBlockSnapshot>(this.blocks),
      edges: new Map<string, StagedEdgeSnapshot>(this.edges),
    }
  }

  private assertOpen(): void {
    if (this.settled) throw new Error('staged rig already settled')
  }
}
