/**
 * A NAM amp as an `AudioWorkletNode`, backed by `packages/core`'s own NAM
 * inference compiled to WASM (`wasm-core/ampWorklet.js`).
 *
 * This replaces the `neural-amp-modeler-wasm` npm package in the audio path.
 * That package works fine, but it is a *second* NAM engine: the desktop app
 * drives `packages/core`'s `NamAmp`, so the same capture and the same preset
 * ran through different inference code depending on the platform. One engine
 * means one behaviour - and it is what a VST3 build can reuse, since a plugin
 * has no npm package or Web Audio to fall back on.
 *
 * Model loading is a port message rather than an AudioParam (see the worklet),
 * so these methods are async and resolve once the core has answered.
 */

const PROCESSOR_NAME = 'nam-amp-processor'

const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

/** What the core reports about a loaded capture (`nam_studio_block_model_info`). */
export interface NamModelInfo {
  /** The rate the capture was trained at, or -1 if it doesn't declare one. */
  sampleRate: number
  hasLoudness: boolean
  loudnessDb: number
  /** The capture's own dBu calibration - not a user-facing level. */
  hasInputLevel: boolean
  inputLevelDbu: number
  hasOutputLevel: boolean
  outputLevelDbu: number
  /** Slimmable captures trade fidelity for CPU at these discrete sizes. */
  slimmable: boolean
  slimmableBreakpoints: number[]
}

interface WorkletReply {
  id: number
  ok: boolean
  error?: string
  info?: NamModelInfo | null
}

function ensureWorkletRegistered(context: BaseAudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = (context as AudioContext).audioWorklet.addModule('/wasm-core/ampWorklet.js')
    registeredContexts.set(context, promise)
  }
  return promise
}

/** Shared with the effect wrappers: AudioWorkletGlobalScope can't be trusted to
 * have fetch(), so the .wasm bytes are fetched here and passed in. */
function fetchWasmBytes(context: BaseAudioContext): Promise<ArrayBuffer> {
  let promise = wasmBytesByContext.get(context)
  if (!promise) {
    promise = fetch('/wasm-core/nam_studio_core.wasm').then((response) => response.arrayBuffer())
    wasmBytesByContext.set(context, promise)
  }
  return promise
}

export class NamAmpNode {
  /** The worklet itself - connect audio to and from this. */
  readonly node: AudioWorkletNode

  private nextMessageId = 1
  private readonly pending = new Map<number, (reply: WorkletReply) => void>()

  // Composition rather than `extends AudioWorkletNode` (which the effect
  // wrappers also avoid): subclassing evaluates AudioWorkletNode at module load,
  // and it doesn't exist in the jsdom/node environments the unit tests run in.
  private constructor(node: AudioWorkletNode) {
    this.node = node
    this.node.port.onmessage = (event: MessageEvent<WorkletReply>) => {
      const resolve = this.pending.get(event.data.id)
      if (!resolve) return
      this.pending.delete(event.data.id)
      resolve(event.data)
    }
  }

  static async create(context: BaseAudioContext): Promise<NamAmpNode> {
    const [, wasmBytes] = await Promise.all([
      ensureWorkletRegistered(context),
      fetchWasmBytes(context),
    ])
    const node = new AudioWorkletNode(context as AudioContext, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBytes },
    })
    return new NamAmpNode(node)
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

  /**
   * Load a capture from its .nam JSON content. Rejects if the core refuses the
   * file, so a bad model surfaces as an error rather than silence.
   */
  async loadModel(json: string, options?: { slimSize?: number }): Promise<NamModelInfo> {
    // Encode here, not in the worklet: AudioWorkletGlobalScope has no
    // TextEncoder, and this keeps the UTF-8 pass off the audio thread. The
    // buffer is transferred rather than copied.
    const bytes = new TextEncoder().encode(json)
    const reply = await this.request(
      {
        type: 'loadModel',
        bytes: bytes.buffer,
        byteLength: bytes.byteLength,
        ...(options?.slimSize === undefined ? {} : { slimSize: options.slimSize }),
      },
      [bytes.buffer],
    )
    if (!reply.ok || !reply.info) {
      throw new Error(reply.error ?? 'the core could not load this NAM model')
    }
    return reply.info
  }

  async unloadModel(): Promise<void> {
    await this.request({ type: 'unloadModel' })
  }

  /**
   * Re-slim a slimmable capture. Cheaper than reloading the model, and a no-op
   * in the core for captures that aren't slimmable.
   */
  async setSlimSize(slimSize: number): Promise<void> {
    await this.request({ type: 'setSlimSize', value: slimSize })
  }

  /**
   * Release the worklet's WASM graph - which holds the loaded capture, often
   * several megabytes - instead of leaving it until the AudioContext closes.
   * The processor ends itself once it has done so.
   */
  async dispose(): Promise<void> {
    await this.request({ type: 'dispose' })
    this.node.disconnect()
    this.pending.clear()
  }
}
