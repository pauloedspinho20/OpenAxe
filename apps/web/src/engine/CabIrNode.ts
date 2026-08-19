/**
 * Cabinet IR convolution as an `AudioWorkletNode`, backed by `packages/core`'s
 * own convolver (`wasm-core/cabWorklet.js`).
 *
 * This replaces the Web Audio `ConvolverNode` the cab block used to use.
 * Convolution was the last piece of the audio path implemented only in the web
 * app, so a cab block on the desktop - driving the same core - passed audio
 * through untouched. One implementation now serves web, desktop and a plugin,
 * and it is zero-latency (a direct FIR head plus FFT partitions).
 *
 * Same shape as `NamAmpNode`: composition rather than subclassing (the class body
 * must not evaluate `AudioWorkletNode` at import time, which the jsdom unit tests
 * don't provide), and the operations that aren't continuous automation are port
 * messages, hence async.
 */

const PROCESSOR_NAME = 'nam-cab-processor'

const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

interface WorkletReply {
  id: number
  ok: boolean
  error?: string
  frames?: number
}

function ensureWorkletRegistered(context: BaseAudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = (context as AudioContext).audioWorklet.addModule('/wasm-core/cabWorklet.js')
    registeredContexts.set(context, promise)
  }
  return promise
}

function fetchWasmBytes(context: BaseAudioContext): Promise<ArrayBuffer> {
  let promise = wasmBytesByContext.get(context)
  if (!promise) {
    promise = fetch('/wasm-core/nam_studio_core.wasm').then((response) => response.arrayBuffer())
    wasmBytesByContext.set(context, promise)
  }
  return promise
}

/**
 * Fold an IR down to the mono buffer the core takes. Cabinet IRs are usually
 * mono already; a stereo one is averaged rather than having a side dropped, so a
 * mid/side-captured IR doesn't lose its centre.
 *
 * No resampling: `decodeAudioData` already returns audio at the context's own
 * sample rate, which is the rate the core's graph runs at.
 */
function toMonoSamples(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice()
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0)
  }
  const scale = 1 / buffer.numberOfChannels
  for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) * scale
  return mono
}

export class CabIrNode {
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

  static async create(context: BaseAudioContext): Promise<CabIrNode> {
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
    return new CabIrNode(node)
  }

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

  /** Install a decoded IR. Resolves with the number of samples the core took. */
  async loadIr(buffer: AudioBuffer): Promise<number> {
    const samples = toMonoSamples(buffer)
    const reply = await this.request({ type: 'loadIr', samples: samples.buffer }, [samples.buffer])
    if (!reply.ok) throw new Error(reply.error ?? 'the core could not load this impulse response')
    return reply.frames ?? 0
  }

  /** Drop the IR; the block passes audio through again. */
  async unloadIr(): Promise<void> {
    await this.request({ type: 'unloadIr' })
  }

  /** Wet/dry blend, 0 = dry only, 1 = the convolved signal alone. */
  setIrMix(mix: number): void {
    const param = this.node.parameters.get('irMix')
    if (param) param.setTargetAtTime(mix, this.node.context.currentTime, 0.01)
  }

  dispose(): void {
    this.node.disconnect()
    this.pending.clear()
  }
}
