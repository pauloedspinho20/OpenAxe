import { COMPILED_BLOCK_KINDS } from '../effects/generatedBlockConfig'
import type { BlockKind } from './blocks/Block'

/**
 * Thin TS wrapper around the single rig `AudioWorkletProcessor`
 * (`wasm-core/openAxeRigWorklet.js`), which owns one openaxe_core module
 * and one openaxe_graph for the whole rig (issue #55). This is the web-path
 * counterpart to the desktop's OpenAxeBridge: every block kind, every
 * connection, every param, trim, bypass, model/IR load and master-bus write is
 * a message resolved against the core's C ABI inside that one worklet, so the
 * web path contains no Web Audio signal routing of its own.
 *
 * Composition rather than subclassing AudioWorkletNode (the class body must not
 * evaluate AudioWorkletNode at import time, which the jsdom unit tests don't
 * provide - same reasoning as NamAmpNode). Operations that must return a result
 * (connect rejection, model info, meters) are request-reply; param/trim/bypass/
 * master writes are fire-and-forget.
 */

const PROCESSOR_NAME = 'nam-studio-rig-processor'

const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

/** packages/core/include/openaxe/api.h's OpenAxeBlockKind, indexed by web BlockKind. */
export const KIND_TO_CORE: Record<BlockKind, number> = {
  'noise-gate': 0,
  compressor: 1,
  eq: 2,
  chorus: 3,
  flanger: 4,
  phaser: 5,
  tremolo: 6,
  delay: 7,
  reverb: 8,
  amp: 9,
  'amp-cab': 10,
  pedal: 11,
  outboard: 12,
  space: 13,
  cab: 14,
  mixer: 15,
  splitter: 16,
  'ring-mod': 17,
  filter: 18,
  'pitch-shifter': 19,
  'granular-delay': 20,
  rotary: 21,
  'send-1': 22,
  'return-1': 23,
  'send-2': 24,
  'return-2': 25,
}

/** What the core reports about a loaded capture (`openaxe_block_model_info`). */
export interface RigModelInfo {
  sampleRate: number
  hasLoudness: boolean
  loudnessDb: number
  hasInputLevel: boolean
  inputLevelDbu: number
  hasOutputLevel: boolean
  outputLevelDbu: number
  slimmable: boolean
  slimmableBreakpoints: number[]
}

export type RigConnectResult = { ok: true } | { ok: false; reason: string }

interface WorkletReply {
  id: number
  ok: boolean
  error?: string
  info?: RigModelInfo | null
  meters?: Record<string, number>
  /** Core block-kind ids this WASM was built with - see assertCompiledKindsMatchConfig. */
  compiledKinds?: number[]
}

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/openAxeRigWorklet.js')
    registeredContexts.set(context, promise)
  }
  return promise
}

/** AudioWorkletGlobalScope can't be trusted to have fetch(), so fetch here. */
function fetchWasmBytes(context: AudioContext): Promise<ArrayBuffer> {
  let promise = wasmBytesByContext.get(context)
  if (!promise) {
    promise = fetch('/wasm-core/openaxe_core.wasm').then((response) => response.arrayBuffer())
    wasmBytesByContext.set(context, promise)
  }
  return promise
}

export class RigWorkletNode {
  /** The worklet itself - connect audio to and from this. */
  readonly node: AudioWorkletNode

  private nextMessageId = 1
  private readonly pending = new Map<number, (reply: WorkletReply) => void>()

  // setParam calls are buffered and flushed once per animation frame so a fast
  // knob drag (hundreds of input events/sec) collapses to at most one message
  // per block/key per frame, instead of allocating a Promise + IPC round-trip
  // per event. The final value for each key wins.
  private readonly paramBuffer = new Map<string, { blockId: string; key: string; value: number }>()
  private paramRafHandle: number | null = null

  private constructor(node: AudioWorkletNode) {
    this.node = node
    this.node.port.onmessage = (event: MessageEvent<WorkletReply>) => {
      const resolve = this.pending.get(event.data.id)
      if (!resolve) return
      this.pending.delete(event.data.id)
      resolve(event.data)
    }
  }

  static async create(context: AudioContext): Promise<RigWorkletNode> {
    const [, wasmBytes] = await Promise.all([
      ensureWorkletRegistered(context),
      fetchWasmBytes(context),
    ])
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // reverbKind: the worklet needs to recognise reverb blocks to route the
      // ReverbControl abstraction, and used to carry its own copy of the
      // ordinal. That copy went stale in #330 (9 vs 8) and silently swallowed
      // every reverb param write, so KIND_TO_CORE is now the single source and
      // the worklet is told rather than told twice.
      processorOptions: { wasmBytes, reverbKind: KIND_TO_CORE.reverb },
    })
    const rig = new RigWorkletNode(node)
    // Deliberately not awaited: this is a diagnostic, and blocking engine
    // startup on a reply that may never arrive would turn a config mismatch
    // into a dead app.
    void rig.assertCompiledKindsMatchConfig()
    return rig
  }

  /**
   * Cross-check the WASM against `effects.config.json` (issue #313).
   *
   * `apps/web/public/wasm-core/openaxe_core.wasm` is a checked-in artifact
   * that only a manual `scripts/build-core-wasm.sh` regenerates, so flipping a
   * kind's `compiled` flag and forgetting the rebuild leaves the palette and
   * the engine disagreeing about which blocks exist - the kind of drift that
   * otherwise shows up as a block that silently refuses to be added. Asking
   * the core directly is the only check that can catch it; a generated file
   * compared against another generated file could not.
   *
   * A mismatch is logged rather than thrown: the app is still usable for every
   * kind both sides agree on, and taking the whole engine down over a stale
   * artifact would be worse than the drift.
   */
  private async assertCompiledKindsMatchConfig(): Promise<void> {
    const maxKind = Math.max(...Object.values(KIND_TO_CORE))
    const reply = await this.request({ type: 'compiledKinds', maxKind })
    const fromCore = reply.compiledKinds
    if (!reply.ok || !Array.isArray(fromCore)) return
    const coreKinds = new Set(fromCore)
    const drift: string[] = []
    for (const [kind, coreId] of Object.entries(KIND_TO_CORE) as [BlockKind, number][]) {
      const inConfig = COMPILED_BLOCK_KINDS.has(kind)
      const inCore = coreKinds.has(coreId)
      if (inConfig !== inCore) {
        drift.push(
          `${kind} (config: ${inConfig ? 'compiled' : 'omitted'}, wasm: ${inCore ? 'compiled' : 'omitted'})`,
        )
      }
    }
    if (drift.length > 0) {
      console.error(
        '[rig] the prebuilt WASM disagrees with packages/core/effects.config.json - ' +
          'run `bash scripts/build-core-wasm.sh` and re-commit the artifacts. Drift: ' +
          drift.join(', '),
      )
    }
  }

  /** Send one message and resolve with the worklet's reply. */
  private request(
    message: Record<string, unknown>,
    transfer?: Transferable[],
  ): Promise<WorkletReply> {
    const id = this.nextMessageId++
    return new Promise<WorkletReply>((resolve) => {
      this.pending.set(id, resolve)
      this.node.port.postMessage({ ...message, id }, transfer ?? [])
    })
  }

  /** Fire-and-forget write; failures surface as a console warning, not a throw. */
  private send(message: Record<string, unknown>): void {
    void this.request(message).then((reply) => {
      if (!reply.ok && reply.error) console.warn(`[rig] ${message.type}: ${reply.error}`)
    })
  }

  // ── Topology ────────────────────────────────────────────────────────────

  addBlock(id: string, kind: BlockKind, row: number, col: number): Promise<void> {
    // The block id travels in a dedicated `block` field: `request` uses the
    // message's `id` field for its own request/reply correlation counter, so any
    // semantic id that rode in under `id` would be clobbered before the worklet
    // saw it (which is how loadModel hit "unknown block" after the rig migration).
    return this.request({ type: 'addBlock', block: id, kind: KIND_TO_CORE[kind], row, col }).then(
      (r) => {
        if (!r.ok) throw new Error(r.error ?? 'addBlock failed')
      },
    )
  }

  removeBlock(id: string): Promise<void> {
    return this.request({ type: 'removeBlock', block: id }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'removeBlock failed')
    })
  }

  moveBlock(id: string, row: number, col: number): Promise<void> {
    return this.request({ type: 'moveBlock', block: id, row, col }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'moveBlock failed')
    })
  }

  async connect(
    from: { blockId: string; port: number },
    to: { blockId: string; port: number },
    id: string,
  ): Promise<RigConnectResult> {
    // The worklet's `toCoreBlock` maps the 'IN'/'OUT' rail sentinels itself, so
    // the raw block ids are forwarded untouched - converting them here (to -1/-2)
    // would make the worklet's rail check (which compares against the strings)
    // miss, and every IN/OUT rail edge would be rejected as an "unknown block",
    // so signal never entered any block (only the pre-graph input/tuner moved).
    const reply = await this.request({
      type: 'connect',
      fromId: from.blockId,
      fromPort: from.port,
      toId: to.blockId,
      toPort: to.port,
      edgeId: id,
    })
    return reply.ok ? { ok: true } : { ok: false, reason: reply.error ?? 'connection rejected' }
  }

  disconnect(edgeId: string): Promise<void> {
    return this.request({ type: 'disconnect', edgeId }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'disconnect failed')
    })
  }

  // ── Params / trims / bypass / master ────────────────────────────────────

  setParam(blockId: string, key: string, value: number): void {
    this.paramBuffer.set(`${blockId}|${key}`, { blockId, key, value })
    if (this.paramRafHandle === null) {
      const flush = () => {
        this.paramRafHandle = null
        this.flushParams()
      }
      this.paramRafHandle =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 0) as unknown as number)
    }
  }

  private flushParams(): void {
    if (this.paramBuffer.size === 0) return
    for (const { blockId, key, value } of this.paramBuffer.values()) {
      this.send({ type: 'setParam', block: blockId, key, value })
    }
    this.paramBuffer.clear()
  }

  setBypass(blockId: string, bypassed: boolean): void {
    this.send({ type: 'setBypass', block: blockId, bypassed })
  }

  /** Set a reverb block's algorithm (hall/room/plate/early-reflections). */
  setReverbAlgorithm(blockId: string, algorithm: string): void {
    this.send({ type: 'setReverbAlgorithm', block: blockId, algorithm })
  }

  setTrim(blockId: string, input?: number, output?: number): void {
    this.send({ type: 'setTrim', block: blockId, input, output })
  }

  setMasterLevel(level: number): void {
    this.send({ type: 'setMasterLevel', level })
  }

  setMasterMuted(muted: boolean): void {
    this.send({ type: 'setMasterMuted', muted })
  }

  setTunerMuted(muted: boolean): void {
    this.send({ type: 'setTunerMuted', tunerMuted: muted })
  }

  // ── NAM models / IR ─────────────────────────────────────────────────────

  /** Load a capture from its .nam JSON content. Rejects if the core refuses it. */
  async loadModel(blockId: string, json: string, slimSize?: number): Promise<RigModelInfo> {
    const bytes = new TextEncoder().encode(json)
    const reply = await this.request(
      {
        type: 'loadModel',
        block: blockId,
        bytes: bytes.buffer,
        byteLength: bytes.byteLength,
        ...(slimSize === undefined ? {} : { slimSize }),
      },
      [bytes.buffer],
    )
    if (!reply.ok || !reply.info)
      throw new Error(reply.error ?? 'the core could not load this model')
    return reply.info
  }

  async unloadModel(blockId: string): Promise<void> {
    await this.request({ type: 'unloadModel', block: blockId })
  }

  async setSlimSize(blockId: string, slimSize: number): Promise<void> {
    await this.request({ type: 'setSlimSize', block: blockId, value: slimSize })
  }

  /** Install a decoded (mono, context-rate) IR on a cab block. */
  async loadIr(blockId: string, samples: Float32Array): Promise<void> {
    await this.request({ type: 'loadIr', block: blockId, samples }, [samples.buffer])
  }

  async unloadIr(blockId: string): Promise<void> {
    await this.request({ type: 'unloadIr', block: blockId })
  }

  // ── Meters ──────────────────────────────────────────────────────────────

  /** Peak per block id from the core's own meters (openaxe_get_meter). */
  async meters(): Promise<Record<string, number>> {
    const reply = await this.request({ type: 'meters' })
    return reply.meters ?? {}
  }

  // ── Teardown ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.request({ type: 'dispose' }).catch(() => {})
    // Apply any buffered param writes before tearing the worklet down.
    this.flushParams()
    this.node.disconnect()
    this.pending.clear()
  }
}
