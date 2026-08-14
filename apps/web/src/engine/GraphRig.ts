import type { NamEngine } from 'neural-amp-modeler-wasm/engine'
import type { Block, BlockKind, EffectParams } from './blocks/Block'
import { createBlock } from './blocks/blockRegistry'
import { MixerBlock } from './blocks/MixerBlock'
import { SplitterBlock } from './blocks/SplitterBlock'
import { IN_RAIL, OUT_RAIL, type Jack } from './gridConfig'
import { canConnect, isEdgeOrderValid, type ValidatableBlock } from './graphValidation'

export { GRID_ROWS, GRID_COLS, IN_RAIL, OUT_RAIL, jack, type Jack } from './gridConfig'

export interface BlockEntry {
  readonly block: Block
  row: number
  col: number
}

export interface Edge {
  readonly from: Jack
  readonly to: Jack
}

export type ConnectResult = { ok: true; id: string } | { ok: false; reason: string }

/**
 * The generic node-graph rig: blocks placed on a GRID_ROWS x GRID_COLS grid,
 * wired by cables, strictly left-to-right by column - column order is what
 * makes cycles impossible by construction, so Web Audio's native cycle
 * rejection never comes into play. Every jack accepts at most one incoming
 * cable; combining two signal paths always requires routing through a
 * Mixer block's several independent input jacks, and fanning one signal out
 * to several downstream chains always requires a Splitter's several
 * independent output jacks.
 *
 * Replaces DualChainRig. `connectInput`/`outputNode` keep the same names as
 * before so useAudioEngine's mic/output-device wiring needs no changes;
 * `connectInput` drops the old 'mono-to-both'/'stereo-split' mode param,
 * since fan-out to multiple column-0 blocks is now just "draw more cables"
 * rather than a fixed rig-level policy.
 */
export class GraphRig {
  private readonly context: AudioContext
  private readonly engine: NamEngine
  private readonly blocks = new Map<string, BlockEntry>()
  private readonly edges = new Map<string, Edge>()
  /** Lazily-created per-block output taps for live meters - see getBlockAnalyser. */
  private readonly analysers = new Map<string, AnalyserNode>()
  private readonly outSink: GainNode
  private readonly masterGain: GainNode
  private readonly limiter: DynamicsCompressorNode
  private inputSource: AudioNode | null = null
  private masterLevel = 1
  private masterMuted = false
  private tunerMuted = false
  private disposed = false
  private nextId = 0

  private constructor(context: AudioContext, engine: NamEngine) {
    this.context = context
    this.engine = engine
    this.outSink = new GainNode(context)
    this.masterGain = new GainNode(context)
    // Fast, hot limiter before the destination - arbitrary user-built
    // parallel merges can sum much hotter than the old fixed 2-chain mix.
    this.limiter = new DynamicsCompressorNode(context, {
      threshold: -3,
      knee: 1,
      ratio: 20,
      attack: 0.001,
      release: 0.05,
    })
    this.outSink.connect(this.masterGain)
    this.masterGain.connect(this.limiter)
  }

  static async create(context: AudioContext, engine: NamEngine): Promise<GraphRig> {
    return new GraphRig(context, engine)
  }

  /** The rig's stereo output - connect to your output device chain / AudioContext.destination. */
  get outputNode(): AudioNode {
    return this.limiter
  }

  private genId(prefix: string): string {
    this.nextId += 1
    return `${prefix}-${this.nextId}`
  }

  // ── Blocks ──────────────────────────────────────────────────────────────

  async addBlock(kind: BlockKind, row: number, col: number, id?: string): Promise<string> {
    const block = await createBlock(this.context, this.engine, kind)
    const blockId = id ?? this.genId('block')
    this.blocks.set(blockId, { block, row, col })
    return blockId
  }

  async removeBlock(id: string): Promise<void> {
    const entry = this.blocks.get(id)
    if (!entry) return
    for (const [edgeId, edge] of [...this.edges]) {
      if (edge.from.blockId === id || edge.to.blockId === id) {
        this.unwireEdge(edge)
        this.edges.delete(edgeId)
      }
    }
    this.blocks.delete(id)
    this.analysers.delete(id)
    await entry.block.dispose()
  }

  /**
   * Reposition a block. If the new column would invalidate one of its
   * existing cables' left-to-right ordering, that cable is auto-dropped
   * (report `droppedEdgeIds` to the user) rather than blocking the move.
   */
  moveBlock(id: string, row: number, col: number): { droppedEdgeIds: string[] } {
    const entry = this.blocks.get(id)
    if (!entry) return { droppedEdgeIds: [] }
    entry.row = row
    entry.col = col
    const validatable = this.validatableBlocks()
    const dropped: string[] = []
    for (const [edgeId, edge] of [...this.edges]) {
      if (edge.from.blockId !== id && edge.to.blockId !== id) continue
      if (!isEdgeOrderValid(validatable, edge)) {
        this.unwireEdge(edge)
        this.edges.delete(edgeId)
        dropped.push(edgeId)
      }
    }
    return { droppedEdgeIds: dropped }
  }

  getBlock(id: string): Block | null {
    return this.blocks.get(id)?.block ?? null
  }

  /**
   * A live meter tap on this block's output - created and connected on
   * first request, then cached (a fan-out tap, so it never touches the
   * signal itself). Null for an unknown block id.
   */
  getBlockAnalyser(id: string): AnalyserNode | null {
    const entry = this.blocks.get(id)
    if (!entry) return null
    let analyser = this.analysers.get(id)
    if (!analyser) {
      analyser = new AnalyserNode(this.context)
      entry.block.outputNode.connect(analyser)
      this.analysers.set(id, analyser)
    }
    return analyser
  }

  getBlockPosition(id: string): { row: number; col: number } | null {
    const entry = this.blocks.get(id)
    return entry ? { row: entry.row, col: entry.col } : null
  }

  setBlockParams(id: string, params: EffectParams): void {
    this.blocks.get(id)?.block.setParams(params)
  }

  listBlockIds(): string[] {
    return [...this.blocks.keys()]
  }

  listEdgeIds(): string[] {
    return [...this.edges.keys()]
  }

  getEdge(id: string): Edge | null {
    return this.edges.get(id) ?? null
  }

  /**
   * Count of Amp/Cab blocks with a model/IR actually loaded - the real cost
   * driver, not grid cell count (an empty Amp/Cab block costs ~nothing).
   * No per-instance CPU number is documented upstream, so this isn't an
   * enforced cap, just a number the UI can use for a soft advisory.
   */
  countActiveHeavyBlocks(): number {
    let count = 0
    for (const entry of this.blocks.values()) {
      const block = entry.block as { getLoadedModel?(): unknown; getLoadedIr?(): unknown }
      if (block.getLoadedModel?.() != null) count++
      if (block.getLoadedIr?.() != null) count++
    }
    return count
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  private validatableBlocks(): Map<string, ValidatableBlock> {
    const map = new Map<string, ValidatableBlock>()
    for (const [id, entry] of this.blocks) {
      map.set(id, { id, kind: entry.block.kind, col: entry.col })
    }
    return map
  }

  private resolveNode(j: Jack, side: 'from' | 'to'): AudioNode | null {
    if (j.blockId === IN_RAIL) return side === 'from' ? this.inputSource : null
    if (j.blockId === OUT_RAIL) return side === 'to' ? this.outSink : null
    const entry = this.blocks.get(j.blockId)
    if (!entry) return null
    if (side === 'to' && entry.block instanceof MixerBlock) return entry.block.inputNodeAt(j.port)
    if (side === 'from' && entry.block instanceof SplitterBlock) {
      return entry.block.outputNodeAt(j.port)
    }
    return side === 'from' ? entry.block.outputNode : entry.block.inputNode
  }

  private wireEdge(edge: Edge): void {
    const target = this.resolveNode(edge.to, 'to')
    const source = this.resolveNode(edge.from, 'from')
    source?.connect(target as AudioNode)
  }

  private unwireEdge(edge: Edge): void {
    const target = this.resolveNode(edge.to, 'to')
    const source = this.resolveNode(edge.from, 'from')
    if (!source || !target) return
    try {
      source.disconnect(target)
    } catch {
      // Already disconnected (e.g. the other endpoint was already torn down) - fine.
    }
  }

  /**
   * Try to connect `from` -> `to`. Validates left-to-right column order and
   * that the target jack isn't already occupied (at most one cable per
   * jack; a Mixer's several ports each count separately). Returns a result
   * rather than throwing so the UI can show inline rejection feedback.
   */
  connect(from: Jack, to: Jack, id?: string): ConnectResult {
    const result = canConnect(this.validatableBlocks(), this.edges.values(), from, to)
    if (!result.ok) return result

    const edgeId = id ?? this.genId('edge')
    const edge: Edge = { from, to }
    this.edges.set(edgeId, edge)
    this.wireEdge(edge)
    return { ok: true, id: edgeId }
  }

  disconnect(edgeId: string): void {
    const edge = this.edges.get(edgeId)
    if (!edge) return
    this.unwireEdge(edge)
    this.edges.delete(edgeId)
  }

  // ── External input / output (mic, output device) ───────────────────────

  /** Feed an external source (e.g. the mic trim node) into the graph's IN rail. */
  connectInput(source: AudioNode): void {
    this.disconnectInput()
    this.inputSource = source
    for (const edge of this.edges.values()) {
      if (edge.from.blockId === IN_RAIL) this.wireEdge(edge)
    }
  }

  disconnectInput(): void {
    if (!this.inputSource) return
    for (const edge of this.edges.values()) {
      if (edge.from.blockId === IN_RAIL) this.unwireEdge(edge)
    }
    this.inputSource = null
  }

  // ── Master utility (fixed, not a block) ─────────────────────────────────

  setMasterLevel(level: number): void {
    this.masterLevel = level
    this.applyMasterGain()
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = muted
    this.applyMasterGain()
  }

  /** Programmatic output silence (e.g. while the tuner dialog is open) - independent of the saved master mute. */
  setTunerMuted(muted: boolean): void {
    this.tunerMuted = muted
    this.applyMasterGain()
  }

  private applyMasterGain(): void {
    const gain = this.masterMuted || this.tunerMuted ? 0 : this.masterLevel
    this.masterGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.disconnectInput()
    for (const edge of this.edges.values()) this.unwireEdge(edge)
    this.edges.clear()
    const disposals: Array<void | Promise<void>> = []
    for (const entry of this.blocks.values()) disposals.push(entry.block.dispose())
    this.blocks.clear()
    this.analysers.clear()
    this.outSink.disconnect()
    this.masterGain.disconnect()
    this.limiter.disconnect()
    await Promise.all(disposals)
  }
}
