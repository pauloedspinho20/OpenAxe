import type { BlockKind } from './blocks/Block'

/**
 * Thin TS wrapper around the single rig `AudioWorkletProcessor`
 * (`wasm-core/namStudioRigWorklet.js`), which owns one nam_studio_core module
 * and one nam_studio_graph for the whole rig (issue #55). This is the web-path
 * counterpart to the desktop's NamStudioBridge: every block kind, every
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

/** packages/core/include/nam_studio/api.h's NamStudioBlockKind, indexed by web BlockKind. */
const KIND_TO_CORE: Record<BlockKind, number> = {
  'noise-gate': 0,
  compressor: 1,
  eq: 2,
  chorus: 3,
  flanger: 4,
  phaser: 5,
  tremolo: 6,
  delay: 7,
  'ping-pong-delay': 8,
  reverb: 9,
  amp: 10,
  'amp-cab': 11,
  pedal: 12,
  outboard: 13,
  space: 14,
  cab: 15,
  mixer: 16,
  splitter: 17,
}

/** The web 'IN'/'OUT' rail sentinels, mapped to the core's -1/-2. */
const RAIL_TO_CORE: Record<string, number> = { IN: -1, OUT: -2 }

/** What the core reports about a loaded capture (`nam_studio_block_model_info`). */
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
}

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/namStudioRigWorklet.js')
    registeredContexts.set(context, promise)
  }
  return promise
}

/** AudioWorkletGlobalScope can't be trusted to have fetch(), so fetch here. */
function fetchWasmBytes(context: AudioContext): Promise<ArrayBuffer> {
  let promise = wasmBytesByContext.get(context)
  if (!promise) {
    promise = fetch('/wasm-core/nam_studio_core.wasm').then((response) => response.arrayBuffer())
    wasmBytesByContext.set(context, promise)
  }
  return promise
}

export class RigWorkletNode {
  /** The worklet itself - connect audio to and from this. */
  readonly node: AudioWorkletNode

  private nextMessageId = 1
  private readonly pending = new Map<number, (reply: WorkletReply) => void>()

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
      processorOptions: { wasmBytes },
    })
    return new RigWorkletNode(node)
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

  private toCore(blockId: string): string | number {
    return RAIL_TO_CORE[blockId] ?? blockId
  }

  // ── Topology ────────────────────────────────────────────────────────────

  addBlock(id: string, kind: BlockKind, row: number, col: number): Promise<void> {
    return this.request({ type: 'addBlock', id, kind: KIND_TO_CORE[kind], row, col }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'addBlock failed')
    })
  }

  removeBlock(id: string): Promise<void> {
    return this.request({ type: 'removeBlock', id }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'removeBlock failed')
    })
  }

  moveBlock(id: string, row: number, col: number): Promise<void> {
    return this.request({ type: 'moveBlock', id, row, col }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'moveBlock failed')
    })
  }

  async connect(
    from: { blockId: string; port: number },
    to: { blockId: string; port: number },
    id: string,
  ): Promise<RigConnectResult> {
    const reply = await this.request({
      type: 'connect',
      fromId: this.toCore(from.blockId),
      fromPort: from.port,
      toId: this.toCore(to.blockId),
      toPort: to.port,
      id,
    })
    return reply.ok ? { ok: true } : { ok: false, reason: reply.error ?? 'connection rejected' }
  }

  disconnect(edgeId: string): Promise<void> {
    return this.request({ type: 'disconnect', id: edgeId }).then((r) => {
      if (!r.ok) throw new Error(r.error ?? 'disconnect failed')
    })
  }

  // ── Params / trims / bypass / master ────────────────────────────────────

  setParam(blockId: string, key: string, value: number): void {
    this.send({ type: 'setParam', block: blockId, key, value })
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

  /** Peak per block id from the core's own meters (nam_studio_get_meter). */
  async meters(): Promise<Record<string, number>> {
    const reply = await this.request({ type: 'meters' })
    return reply.meters ?? {}
  }

  // ── Teardown ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.request({ type: 'dispose' }).catch(() => {})
    this.node.disconnect()
    this.pending.clear()
  }
}
