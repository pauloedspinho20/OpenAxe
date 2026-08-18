import type { GraphRigControls } from '../engine/bindGraphRig'
import type { Block, BlockKind, EffectParams } from '../engine/blocks/Block'
import { IN_RAIL, OUT_RAIL, type Jack } from '../engine/gridConfig'
import {
  canConnect,
  canMoveTo,
  type ConnectResult as ValidatableConnectResult,
  type ValidatableBlock,
} from '../engine/graphValidation'
import type { PresetRig } from '../presets/types'
import { NativeAnalyser, peakSineSource } from './NativeAnalyser'
import { NativeBlock } from './NativeBlock'
import type { NamStudioBridge } from './namStudio'

export type ConnectResult = { ok: true; id: string } | { ok: false; reason: string }

/**
 * The desktop native rig: a drop-in for `GraphRig` (satisfies
 * `GraphRigControls`, which `bindGraphRig` mirrors graphStore into, plus the
 * `PresetRig` slice) that drives the C++ DSP core through `window.namStudio`
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
export class NativeGraphRig implements GraphRigControls, PresetRig {
  private readonly bridge: NamStudioBridge
  private readonly blocks = new Map<string, { block: NativeBlock; row: number; col: number }>()
  private readonly edges = new Map<string, { from: Jack; to: Jack }>()
  private readonly analysers = new Map<string, NativeAnalyser>()
  private readonly peaks = new Map<string, number>()
  private disposed = false
  private nextId = 0

  constructor(bridge: NamStudioBridge) {
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
    }
    return count
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  connect(from: Jack, to: Jack, id?: string): ConnectResult {
    const result = canConnect(this.validatableBlocks(), this.edges.values(), from, to)
    if (!result.ok) return result

    const edgeId = id ?? this.genId('edge')
    this.edges.set(edgeId, { from, to })
    void this.bridge.connect({
      fromId: this.mapJack(from),
      fromPort: from.port,
      toId: this.mapJack(to),
      toPort: to.port,
      id: edgeId,
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

  /** Drive a block's facade meter to a peak level (0..1). Safe to call often. */
  updateMeter(id: string, peak: number): void {
    this.peaks.set(id, peak)
  }

  private validatableBlocks(): Map<string, ValidatableBlock> {
    const map = new Map<string, ValidatableBlock>()
    for (const [id, entry] of this.blocks) {
      map.set(id, { id, kind: entry.block.kind, col: entry.col })
    }
    return map
  }

  // ── Teardown ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.analysers.clear()
    this.peaks.clear()
    this.blocks.clear()
    this.edges.clear()
  }
}
