import type { GraphRigControls } from '../engine/bindGraphRig'
import type { Block, BlockKind, EffectParams } from '../engine/blocks/Block'
import { IN_RAIL, OUT_RAIL, jack, type Jack } from '../engine/gridConfig'
import {
  canConnect,
  canMoveTo,
  type ConnectResult as ValidatableConnectResult,
  type ValidatableBlock,
} from '../engine/graphValidation'
import type { PresetRig, StageCapableRig, StagedPresetRig } from '../presets/types'
import type { StagedBlockSnapshot, StagedEdgeSnapshot } from '../presets/types'
import { NativeAnalyser, peakSineSource } from './NativeAnalyser'
import { NativeBlock } from './NativeBlock'
import { type OpenAxeBridge, stagedBridgeView } from './openaxe'
import { STAGE_COMMIT_DRAIN_MS, STAGE_COMMIT_FADE_MS } from '../engine/StagedRig'

export type ConnectResult = { ok: true; id: string } | { ok: false; reason: string }

/**
 * The desktop native rig: a drop-in for `GraphRig` (satisfies
 * `GraphRigControls`, which `bindGraphRig` mirrors graphStore into, plus the
 * `PresetRig` slice) that drives the C++ DSP core through `window.openAxe`
 * instead of Web Audio nodes.
 *
 * Connection/placement validation is reused verbatim from the web engine
 * (`canConnect`/`canMoveTo`) so a UI-level connect and the native core can
 * never disagree; a connect that passes that check is forwarded to the bridge
 * (which re-validates against the C++ graph). Web `'IN'`/`'OUT'` rail strings
 * map to the core sentinels -1/-2.
 *
 * The actual audio device I/O is owned by the C++ side (RtAudio). The rig
 * holds no AudioNodes; `getBlockAnalyser` returns a Web-Audio-free
 * `NativeAnalyser` (fed a sine scaled to the block's real native meter peak by
 * the native engine, so the existing meter widgets animate from true levels).
 */
export class NativeGraphRig implements GraphRigControls, PresetRig, StageCapableRig {
  private readonly bridge: OpenAxeBridge
  private readonly blocks = new Map<string, { block: NativeBlock; row: number; col: number }>()
  private readonly edges = new Map<string, { from: Jack; to: Jack }>()
  private readonly analysers = new Map<string, NativeAnalyser>()
  private readonly inputAnalysers = new Map<string, NativeAnalyser>()
  private readonly peaks = new Map<string, number>()
  private readonly inputPeaks = new Map<string, number>()
  private readonly gainReductions = new Map<string, number>()
  private readonly gateGains = new Map<string, number>()
  private disposed = false
  private nextId = 0

  constructor(bridge: OpenAxeBridge) {
    this.bridge = bridge
  }

  private genId(prefix: string): string {
    this.nextId += 1
    return `${prefix}-${this.nextId}`
  }

  private mapJack(j: Jack): number | string {
    if (j.blockId === IN_RAIL) return -1
    if (j.blockId === OUT_RAIL) return -2
    return j.blockId
  }

  // ── Blocks ──────────────────────────────────────────────────────────────

  async addBlock(kind: BlockKind, row: number, col: number, id?: string): Promise<string> {
    const jsId = id ?? this.genId('block')
    const result = await this.bridge.addBlock({ kind, row, col, id: jsId })
    if (!result.ok) throw new Error(result.error ?? 'addBlock failed')
    this.blocks.set(jsId, { block: new NativeBlock(this.bridge, jsId, kind), row, col })
    return jsId
  }

  /**
   * Adopt the rig the C++ core already holds, without touching the graph.
   *
   * In a plugin the core is the source of truth (issue #300 D1/D2): the DAW
   * restores its chunk into the graph before the editor ever opens, and closing
   * the editor destroys this object while the graph keeps playing. So on open
   * there are already blocks and edges in the core that this rig knows nothing
   * about — re-adding them would duplicate the whole signal chain.
   *
   * This only populates the local bookkeeping from `openAxe.getState`; every id
   * is the core's own id, so subsequent setParam/removeBlock address the right
   * block. Returns the blocks and edges in the shape graphStore.loadGraph wants.
   */
  async adoptFromCore(): Promise<{
    blocks: {
      id: string
      kind: BlockKind
      row: number
      col: number
      bypass?: boolean
      params: EffectParams
    }[]
    edges: { id: string; from: Jack; to: Jack }[]
    masterLevel: number
    masterMuted: boolean
  } | null> {
    const result = await this.bridge.getState()
    if (!result.ok || !result.state) return null

    this.blocks.clear()
    this.edges.clear()
    this.analysers.clear()
    this.inputAnalysers.clear()
    this.peaks.clear()
    this.inputPeaks.clear()
    this.gainReductions.clear()
    this.gateGains.clear()

    const blocks = result.state.blocks.map((b) => {
      const kind = b.kind as BlockKind
      this.blocks.set(b.id, {
        block: new NativeBlock(this.bridge, b.id, kind),
        row: b.row,
        col: b.col,
      })
      // The core reports params by symbol with real (not normalised) values,
      // which is the same shape the store holds.
      // exactOptionalPropertyTypes: omit `bypass` entirely when the core did
      // not report one, rather than setting it to undefined.
      return {
        id: b.id,
        kind,
        row: b.row,
        col: b.col,
        ...(b.bypass === undefined ? {} : { bypass: b.bypass }),
        params: (b.params ?? {}) as EffectParams,
      }
    })

    // The core writes the rails as the numeric sentinels; the UI speaks
    // IN_RAIL/OUT_RAIL.
    const toJack = (side: { blockId: string; port: number }): Jack => {
      if (side.blockId === '-1' || side.blockId === 'IN') return jack(IN_RAIL, side.port)
      if (side.blockId === '-2' || side.blockId === 'OUT') return jack(OUT_RAIL, side.port)
      return jack(side.blockId, side.port)
    }
    const edges = result.state.edges.map((e) => {
      const from = toJack(e.from)
      const to = toJack(e.to)
      this.edges.set(e.id, { from, to })
      return { id: e.id, from, to }
    })

    return {
      blocks,
      edges,
      masterLevel: result.state.masterLevel ?? 1,
      masterMuted: result.state.masterMuted ?? false,
    }
  }

  async removeBlock(id: string): Promise<void> {
    const entry = this.blocks.get(id)
    if (!entry) return
    for (const [edgeId, edge] of [...this.edges]) {
      if (edge.from.blockId === id || edge.to.blockId === id) {
        this.edges.delete(edgeId)
      }
    }
    this.analysers.delete(id)
    this.peaks.delete(id)
    this.gainReductions.delete(id)
    this.gateGains.delete(id)
    this.blocks.delete(id)
    await this.bridge.removeBlock({ blockId: id })
  }

  moveBlock(id: string, row: number, col: number): ValidatableConnectResult {
    const entry = this.blocks.get(id)
    if (!entry) return { ok: false, reason: 'Unknown block' }
    const move = canMoveTo(this.validatableBlocks(), this.edges.values(), id, col)
    if (!move.ok) return move
    entry.row = row
    entry.col = col
    void this.bridge.moveBlock({ blockId: id, row, col })
    return { ok: true }
  }

  getBlock(id: string): Block | null {
    // Consumers duck-type the PresetBlock/BlockLoadTarget surface NativeBlock
    // actually implements; the AudioNode members of `Block` are never touched.
    return (this.blocks.get(id)?.block ?? null) as unknown as Block | null
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

  countActiveHeavyBlocks(): number {
    let count = 0
    for (const { block } of this.blocks.values()) {
      if (block.getLoadedModel() != null) count++
      // Mirrors web GraphRig: a cab IR convolves for real in the C++ core, so
      // it must count as a heavy block on the native path too.
      if (block.getLoadedIr() != null) count++
    }
    return count
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  connect(from: Jack, to: Jack, id?: string): ConnectResult {
    const result = canConnect(this.validatableBlocks(), this.edges.values(), from, to)
    if (!result.ok) return result

    const edgeId = id ?? this.genId('edge')
    this.edges.set(edgeId, { from, to })
    // The bridge re-validates against the core's graph_validation rules; a
    // rejected edge is dropped locally so the UI can't believe it exists
    // (mirrors GraphRig.connect on the web path).
    void this.bridge
      .connect({
        fromId: this.mapJack(from),
        fromPort: from.port,
        toId: this.mapJack(to),
        toPort: to.port,
        id: edgeId,
      })
      .then((r) => {
        if (!r.ok) this.edges.delete(edgeId)
      })
    return { ok: true, id: edgeId }
  }

  disconnect(edgeId: string): void {
    this.edges.delete(edgeId)
    void this.bridge.disconnect({ edgeId })
  }

  // ── Master bus ───────────────────────────────────────────────────────────

  setMasterLevel(level: number): void {
    void this.bridge.setMasterLevel({ level })
  }

  setMasterMuted(muted: boolean): void {
    void this.bridge.setMasterMuted({ muted })
  }

  setTunerMuted(muted: boolean): void {
    void this.bridge.setTunerMuted({ muted })
  }

  // ── Facade meters ───────────────────────────────────────────────────────

  /**
   * A live meter tap for this block's output: a Web-Audio-free `NativeAnalyser`
   * fed a sine whose amplitude the native engine drives to the block's real
   * peak (updateMeter). The existing meter widgets read getByteTimeDomainData
   * and see the true level, just not the true waveform. Null for an unknown
   * block.
   */
  getBlockAnalyser(id: string): NativeAnalyser | null {
    const entry = this.blocks.get(id)
    if (!entry) return null
    let cached = this.analysers.get(id)
    if (!cached) {
      cached = new NativeAnalyser({
        fftSize: 256,
        sampleRate: 48000,
        read: peakSineSource(256, 48000, () => this.peaks.get(id) ?? 0),
      })
      this.analysers.set(id, cached)
    }
    return cached
  }

  /**
   * A live meter tap for this block's input (post input trim) - the IN half
   * of the inspector's IN/OUT pair, fed by the native bridge's per-block
   * input peak (updateInputMeter). Null for an unknown block.
   */
  getBlockInputAnalyser(id: string): NativeAnalyser | null {
    const entry = this.blocks.get(id)
    if (!entry) return null
    let cached = this.inputAnalysers.get(id)
    if (!cached) {
      cached = new NativeAnalyser({
        fftSize: 256,
        sampleRate: 48000,
        read: peakSineSource(256, 48000, () => this.inputPeaks.get(id) ?? 0),
      })
      this.inputAnalysers.set(id, cached)
    }
    return cached
  }

  /** Drive a block's facade meter to a peak level (0..1). Safe to call often. */
  updateMeter(id: string, peak: number): void {
    this.peaks.set(id, peak)
  }

  /** Drive a block's input-meter facade to a peak level (0..1). Safe to call often. */
  updateInputMeter(id: string, peak: number): void {
    this.inputPeaks.set(id, peak)
  }

  getGainReduction(id: string): number {
    return this.gainReductions.get(id) ?? 0
  }
  getGateGain(id: string): number {
    return this.gateGains.get(id) ?? 0
  }
  updateGainReduction(id: string, grDb: number): void {
    this.gainReductions.set(id, grDb)
  }
  updateGateGain(id: string, gain: number): void {
    this.gateGains.set(id, gain)
  }

  private validatableBlocks(): Map<string, ValidatableBlock> {
    const map = new Map<string, ValidatableBlock>()
    for (const [id, entry] of this.blocks) {
      map.set(id, { id, kind: entry.block.kind, col: entry.col })
    }
    return map
  }

  // ── Gapless staged switching (issue #367) ───────────────────────────

  /**
   * Open a staged graph on the native core for the next rig. The staged build
   * drives the same bridge with `stage: true` (see stagedBridgeView), so
   * NativeBlock facades work unchanged; commit crossfades it live with no
   * suspend handshake. Throws when the shell predates staged switching - the
   * caller falls back to teardown-and-rebuild.
   */
  async beginStage(): Promise<StagedPresetRig> {
    const result = await this.bridge.stageBegin().catch(() => null)
    if (!result || !result.ok) throw new Error('staged switching unsupported by this shell')
    return new NativeStagedRig(this.bridge)
  }

  /**
   * Take over a successfully committed staged rig: the live core graph IS the
   * staged engine now, so the bookkeeping swaps wholesale and the facades are
   * rebuilt with their already-live state carried over silently.
   */
  adoptStage(staged: StagedPresetRig): void {
    const { blocks, edges } = staged.takeEntries()
    const seen = new Set<string>()
    for (const [id, entry] of blocks) {
      seen.add(id)
      const snapshot = entry.block.snapshotBlockState?.()
      const live = new NativeBlock(this.bridge, id, entry.kind)
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

  // ── Teardown ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // Tear down the C++ graph before clearing the JS mirrors. The next power-on
    // replays the same graphStore ids through bindGraphRig, so if the core's
    // blocks/edges survive here its HandleAddBlock returns "block id already
    // exists", reconcile rejects, and the bindGraphRig promise chain dies -
    // every power cycle after the first silently stops syncing the graph.
    // Edges are removed first; removeBlock may not clean up dangling edges on
    // every core version, so dropping them explicitly keeps the two in sync.
    const edgeIds = [...this.edges.keys()]
    const blockIds = [...this.blocks.keys()]
    await Promise.all(
      edgeIds.map((id) => this.bridge.disconnect({ edgeId: id }).catch(() => undefined)),
    )
    await Promise.all(
      blockIds.map((id) => this.bridge.removeBlock({ blockId: id }).catch(() => undefined)),
    )
    this.analysers.clear()
    this.inputAnalysers.clear()
    this.peaks.clear()
    this.inputPeaks.clear()
    this.gainReductions.clear()
    this.gateGains.clear()
    this.blocks.clear()
    this.edges.clear()
  }
}

/** How long commit retries while a previous switch is still draining. */
const NATIVE_COMMIT_BUSY_TIMEOUT_MS = 3000
const NATIVE_COMMIT_BUSY_POLL_MS = 25

/**
 * Builder for the next rig on the native core's staged graph (issue #367).
 * Drives the same bridge through stagedBridgeView so NativeBlock facades work
 * unchanged, then crossfades it live with commit(). Mirrors StagedRig on the
 * web path; a failed build must discard() so the staged graph never leaks.
 */
class NativeStagedRig implements StagedPresetRig {
  private readonly staged: OpenAxeBridge
  private readonly blocks = new Map<
    string,
    { block: NativeBlock; kind: BlockKind; row: number; col: number }
  >()
  private readonly edges = new Map<string, { from: Jack; to: Jack }>()
  private settled = false

  constructor(bridge: OpenAxeBridge) {
    this.staged = stagedBridgeView(bridge)
  }

  async addBlock(kind: BlockKind, row: number, col: number, id: string): Promise<string> {
    this.assertOpen()
    const result = await this.staged.addBlock({ kind, row, col, id })
    if (!result.ok) throw new Error(result.error ?? 'addBlock (staged) failed')
    this.blocks.set(id, { block: new NativeBlock(this.staged, id, kind), kind, row, col })
    return id
  }

  getBlock(id: string): NativeBlock | null {
    return this.blocks.get(id)?.block ?? null
  }

  /**
   * Connect two staged blocks, validated locally first (same rules as the
   * live rig) and awaited against the core so a rejection is known before
   * the commit.
   */
  async connectAndWait(
    from: Jack,
    to: Jack,
    id: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    this.assertOpen()
    const blocks = new Map<string, ValidatableBlock>()
    for (const [blockId, entry] of this.blocks) {
      blocks.set(blockId, { id: blockId, kind: entry.kind, col: entry.col })
    }
    const valid = canConnect(blocks, this.edges.values(), from, to)
    if (!valid.ok) return valid
    const reply = await this.staged.connect({
      fromId: from.blockId === IN_RAIL ? -1 : from.blockId === OUT_RAIL ? -2 : from.blockId,
      fromPort: from.port,
      toId: to.blockId === IN_RAIL ? -1 : to.blockId === OUT_RAIL ? -2 : to.blockId,
      toPort: to.port,
      id,
    })
    if (!reply.ok) return { ok: false, reason: reply.error ?? 'connection rejected' }
    this.edges.set(id, { from, to })
    return { ok: true }
  }

  async commit(): Promise<void> {
    this.assertOpen()
    const deadline = Date.now() + NATIVE_COMMIT_BUSY_TIMEOUT_MS
    for (;;) {
      const result = await this.staged.stageCommit({
        fadeMs: STAGE_COMMIT_FADE_MS,
        drainMs: STAGE_COMMIT_DRAIN_MS,
      })
      if (result.ok) {
        this.settled = true
        return
      }
      if (!result.busy || Date.now() >= deadline) {
        throw new Error(result.error ?? 'stageCommit failed')
      }
      await new Promise((resolve) => setTimeout(resolve, NATIVE_COMMIT_BUSY_POLL_MS))
    }
  }

  async discard(): Promise<void> {
    if (this.settled) return
    this.settled = true
    await this.staged.stageDiscard().catch(() => {})
  }

  takeEntries(): {
    blocks: Map<string, StagedBlockSnapshot>
    edges: Map<string, StagedEdgeSnapshot>
  } {
    if (!this.settled) throw new Error('takeEntries before a successful commit')
    return {
      blocks: new Map<string, StagedBlockSnapshot>(this.blocks),
      edges: new Map<string, StagedEdgeSnapshot>(this.edges),
    }
  }

  private assertOpen(): void {
    if (this.settled) throw new Error('staged rig already settled')
  }
}
