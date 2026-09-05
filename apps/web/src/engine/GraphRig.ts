import type { Block, BlockKind, EffectParams } from './blocks/Block'
import type { Jack } from './gridConfig'
import {
  canConnect,
  canMoveTo,
  type ConnectResult as ValidatableConnectResult,
  type ValidatableBlock,
} from './graphValidation'
import type { GraphRigControls } from './bindGraphRig'
import { RigWorkletNode } from './RigWorkletNode'
import { RigBlock } from './RigBlock'
import { StagedRig } from './StagedRig'
import { NativeAnalyser, peakSineSource } from '../native/NativeAnalyser'
import type { PresetRig, StageCapableRig, StagedPresetRig } from '../presets/types'

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
 * The web rig: a thin driver over the single rig `AudioWorkletProcessor`
 * (issue #55). It owns one `RigWorkletNode`, which in turn owns one
 * openaxe_core module and one openaxe_graph holding the whole rig - every
 * block kind, connection, param, trim, bypass, model/IR and the master bus
 * live in the core. This class is the Web Audio path's analogue of the
 * desktop's NativeGraphRig: it keeps the same block/edge bookkeeping and UI
 * validation (`canConnect`/`canMoveTo` from graphValidation.ts), then forwards
 * every mutation to the worklet's message port, which serialises it against
 * process() on the audio thread.
 *
 * The web audio path therefore contains no signal routing: no `connect()`
 * between DSP nodes, no mixer/master GainNodes, no wet/dry staging.
 * The only Web Audio the rig owns is the single worklet node feeding the
 * graph's IN rail from the mic and carrying the graph's OUT rail to the
 * destination. Per-block meters come from `openaxe_get_meter` (output) and
 * `openaxe_get_input_meter` (post-trim input), polled here and each
 * presented through a Web-Audio-free `NativeAnalyser` facade fed a sine scaled
 * to each block's real peak - identical to the desktop path.
 */
export class GraphRig implements GraphRigControls, PresetRig, StageCapableRig {
  private readonly worklet: RigWorkletNode
  private readonly context: AudioContext
  private readonly blocks = new Map<string, { block: RigBlock; row: number; col: number }>()
  private readonly edges = new Map<string, Edge>()
  private readonly analysers = new Map<string, NativeAnalyser>()
  private readonly inputAnalysers = new Map<string, NativeAnalyser>()
  private readonly peaks = new Map<string, number>()
  private readonly inputPeaks = new Map<string, number>()
  private readonly gainReductions = new Map<string, number>()
  private readonly gateGains = new Map<string, number>()
  private inputSource: AudioNode | null = null
  private disposed = false
  private nextId = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null

  private constructor(context: AudioContext, worklet: RigWorkletNode) {
    this.context = context
    this.worklet = worklet
  }

  static async create(context: AudioContext): Promise<GraphRig> {
    const worklet = await RigWorkletNode.create(context)
    const rig = new GraphRig(context, worklet)
    rig.startMeterPolling()
    return rig
  }

  get audioContext(): AudioContext {
    return this.context
  }

  /** The rig's single output - the worklet node carrying the core graph's OUT rail. Connect this to your output chain / AudioContext.destination. */
  get outputNode(): AudioNode {
    return this.worklet.node
  }

  private genId(prefix: string): string {
    this.nextId += 1
    return `${prefix}-${this.nextId}`
  }

  private startMeterPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.worklet
        .meters()
        .then((meters) => {
          for (const [id, peak] of Object.entries(meters)) this.peaks.set(id, peak)
        })
        .catch(() => {})
      void this.worklet
        .inputMeters()
        .then((meters) => {
          for (const [id, peak] of Object.entries(meters)) this.inputPeaks.set(id, peak)
        })
        .catch(() => {})
      const w = this.worklet as unknown as {
        gainReductions?: () => Promise<Record<string, number>>
        gateGains?: () => Promise<Record<string, number>>
      }
      if (typeof w.gainReductions === 'function') {
        void w
          .gainReductions()
          .then((grs) => {
            for (const [id, gr] of Object.entries(grs)) this.gainReductions.set(id, gr)
          })
          .catch(() => {})
      }
      if (typeof w.gateGains === 'function') {
        void w
          .gateGains()
          .then((gains) => {
            for (const [id, gain] of Object.entries(gains)) this.gateGains.set(id, gain)
          })
          .catch(() => {})
      }
    }, 50)
  }

  // ── Blocks ──────────────────────────────────────────────────────────────

  async addBlock(kind: BlockKind, row: number, col: number, id?: string): Promise<string> {
    const blockId = id ?? this.genId('block')
    await this.worklet.addBlock(blockId, kind, row, col)
    this.blocks.set(blockId, { block: new RigBlock(this.worklet, blockId, kind), row, col })
    return blockId
  }

  async removeBlock(id: string): Promise<void> {
    const entry = this.blocks.get(id)
    if (!entry) return
    for (const [edgeId, edge] of [...this.edges]) {
      if (edge.from.blockId === id || edge.to.blockId === id) this.edges.delete(edgeId)
    }
    this.analysers.delete(id)
    this.inputAnalysers.delete(id)
    this.peaks.delete(id)
    this.inputPeaks.delete(id)
    this.gainReductions.delete(id)
    this.gateGains.delete(id)
    this.blocks.delete(id)
    await this.worklet.removeBlock(id)
  }

  moveBlock(id: string, row: number, col: number): ValidatableConnectResult {
    const entry = this.blocks.get(id)
    if (!entry) return { ok: false, reason: 'Unknown block' }
    const move = canMoveTo(this.validatableBlocks(), this.edges.values(), id, col)
    if (!move.ok) return move
    entry.row = row
    entry.col = col
    void this.worklet.moveBlock(id, row, col)
    return { ok: true }
  }

  getBlock(id: string): Block | null {
    // Consumers duck-type the PresetBlock/BlockLoadTarget surface RigBlock
    // actually implements; the AudioNode members of `Block` are never touched.
    return (this.blocks.get(id)?.block ?? null) as unknown as Block | null
  }

  /** Drive a block's meter facade to a peak level (0..1). Safe to call often. */
  updateMeter(id: string, peak: number): void {
    this.peaks.set(id, peak)
  }

  /** Drive a block's input-meter facade to a peak level (0..1). Safe to call often. */
  updateInputMeter(id: string, peak: number): void {
    this.inputPeaks.set(id, peak)
  }

  /** Current gain reduction in dB (≤0) for a block, 0 if unknown/not a dynamics block. */
  getGainReduction(id: string): number {
    return this.gainReductions.get(id) ?? 0
  }

  /** Current gate openness 0..1 (1 = open) for a gate block, 0 if unknown/not a gate. */
  getGateGain(id: string): number {
    return this.gateGains.get(id) ?? 0
  }

  /** Update helpers for tests / NativeGraphRig path. */
  updateGainReduction(id: string, grDb: number): void {
    this.gainReductions.set(id, grDb)
  }
  updateGateGain(id: string, gain: number): void {
    this.gateGains.set(id, gain)
  }

  /**
   * A live meter tap for this block's output: a Web-Audio-free `NativeAnalyser`
   * fed a sine whose amplitude tracks the block's real core peak
   * (`openaxe_get_meter`, polled via updateMeter). Cast to `AnalyserNode` at
   * the boundary because the shared meter widgets consume the narrow
   * getByteTimeDomainData surface - the same cast the desktop engine applies to
   * its NativeAnalyser, so web and desktop present the same type. Null for an
   * unknown block.
   */
  getBlockAnalyser(id: string): AnalyserNode | null {
    const entry = this.blocks.get(id)
    if (!entry) return null
    let cached = this.analysers.get(id)
    if (!cached) {
      cached = new NativeAnalyser({
        fftSize: 256,
        sampleRate: this.context.sampleRate,
        read: peakSineSource(256, this.context.sampleRate, () => this.peaks.get(id) ?? 0),
      })
      this.analysers.set(id, cached)
    }
    return cached as unknown as AnalyserNode
  }

  /**
   * A live meter tap for this block's input (post input trim) - the IN half
   * of the inspector's IN/OUT pair. Same NativeAnalyser facade as
   * getBlockAnalyser, fed by the core's input peak
   * (`openaxe_get_input_meter`). Null for an unknown block.
   */
  getBlockInputAnalyser(id: string): AnalyserNode | null {
    const entry = this.blocks.get(id)
    if (!entry) return null
    let cached = this.inputAnalysers.get(id)
    if (!cached) {
      cached = new NativeAnalyser({
        fftSize: 256,
        sampleRate: this.context.sampleRate,
        read: peakSineSource(256, this.context.sampleRate, () => this.inputPeaks.get(id) ?? 0),
      })
      this.inputAnalysers.set(id, cached)
    }
    return cached as unknown as AnalyserNode
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

  countActiveHeavyBlocks(): number {
    let count = 0
    for (const { block } of this.blocks.values()) {
      if (block.getLoadedModel() != null) count++
      if (block.getLoadedIr() != null) count++
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

  connect(from: Jack, to: Jack, id?: string): ConnectResult {
    const result = canConnect(this.validatableBlocks(), this.edges.values(), from, to)
    if (!result.ok) return result

    const edgeId = id ?? this.genId('edge')
    this.edges.set(edgeId, { from, to })
    // The worklet re-validates against the core's graph_validation rules; a
    // rejected edge is dropped locally so the UI can't believe it exists.
    void this.worklet.connect(from, to, edgeId).then((r) => {
      if (!r.ok) this.edges.delete(edgeId)
    })
    return { ok: true, id: edgeId }
  }

  disconnect(edgeId: string): void {
    this.edges.delete(edgeId)
    void this.worklet.disconnect(edgeId)
  }

  // ── External input / output (mic) ───────────────────────────────────────

  /** Feed an external source (e.g. the mic trim node) into the rig worklet's input, which is the graph's IN rail. */
  connectInput(source: AudioNode): void {
    this.disconnectInput()
    this.inputSource = source
    source.connect(this.worklet.node)
  }

  disconnectInput(): void {
    if (!this.inputSource) return
    try {
      this.inputSource.disconnect(this.worklet.node)
    } catch {
      // Already disconnected - fine.
    }
    this.inputSource = null
  }

  // ── Master bus (forwarded to the core through the worklet) ──────────────

  setMasterLevel(level: number): void {
    this.worklet.setMasterLevel(level)
  }

  setMasterMuted(muted: boolean): void {
    this.worklet.setMasterMuted(muted)
  }

  setTunerMuted(muted: boolean): void {
    this.worklet.setTunerMuted(muted)
  }

  // ── Gapless staged switching (issue #367) ───────────────────────────

  /**
   * Open a staged graph for the next rig. Built with StagedRig (same block
   * ids, same preset data), made live by StagedRig.commit's crossfade, then
   * handed back here via adoptStage. Throws when the WASM predates staged
   * switching - the caller falls back to teardown-and-rebuild.
   */
  async beginStage(): Promise<StagedPresetRig> {
    return StagedRig.begin(this.worklet)
  }

  /**
   * Take over a successfully committed staged rig: the live core graph IS
   * the staged engine now, so the bookkeeping swaps wholesale. Live facades
   * are rebuilt around the same js ids (the staged ones still point at the
   * consumed staged graph) with their already-live state carried over
   * silently; meter/analyser caches for vanished ids are pruned.
   */
  adoptStage(staged: StagedPresetRig): void {
    const { blocks, edges } = staged.takeEntries()
    const seen = new Set<string>()
    for (const [id, entry] of blocks) {
      seen.add(id)
      const snapshot = entry.block.snapshotBlockState?.()
      const live = new RigBlock(this.worklet, id, entry.kind)
      if (snapshot) live.restoreBlockState?.(snapshot)
      this.blocks.set(id, { block: live, row: entry.row, col: entry.col })
    }
    for (const id of [...this.blocks.keys()]) {
      if (!seen.has(id)) {
        this.blocks.delete(id)
        this.analysers.delete(id)
        this.inputAnalysers.delete(id)
        this.peaks.delete(id)
        this.inputPeaks.delete(id)
        this.gainReductions.delete(id)
        this.gateGains.delete(id)
      }
    }
    this.edges.clear()
    for (const [id, edge] of edges) {
      this.edges.set(id, { from: edge.from, to: edge.to })
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.disconnectInput()
    this.edges.clear()
    this.blocks.clear()
    this.analysers.clear()
    this.inputAnalysers.clear()
    this.peaks.clear()
    this.inputPeaks.clear()
    this.gainReductions.clear()
    this.gateGains.clear()
    await this.worklet.dispose()
  }
}
