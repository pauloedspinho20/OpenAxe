import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'dragonfly-reverb-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

const ALGORITHMS = ['hall', 'room', 'plate', 'early-reflections'] as const
type ReverbAlgorithm = (typeof ALGORITHMS)[number]
const ALGORITHM_INDEX: Record<ReverbAlgorithm, number> = {
  hall: 0,
  room: 1,
  plate: 2,
  'early-reflections': 3,
}

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/dragonflyReverbWorklet.js')
    registeredContexts.set(context, promise)
  }
  return promise
}

function fetchWasmBytes(context: AudioContext): Promise<ArrayBuffer> {
  let promise = wasmBytesByContext.get(context)
  if (!promise) {
    promise = fetch('/wasm-core/nam_studio_core.wasm').then((response) => response.arrayBuffer())
    wasmBytesByContext.set(context, promise)
  }
  return promise
}

/**
 * Four Dragonfly Reverb algorithms (packages/core compiled to WASM): Hall,
 * Room, Plate, and Early Reflections. The `reverbAlgorithm` AudioParam
 * selects which algorithm backs the block. Each algorithm exposes a
 * different subset of the 7 user-facing knobs — roomSize and damping (both
 * Freeverb-compatible remappings of decay/highCut) are universal; width,
 * predelay, spin, wander, and earlySend vary by algorithm (see
 * dragonflyReverbWorklet.js for per-algorithm index maps). Knobs that don't
 * exist for the current algorithm are harmlessly ignored by the C++ side.
 */
export class DragonflyReverb extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'reverb', 'Reverb', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<DragonflyReverb> {
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
    return new DragonflyReverb(context, node)
  }

  /** Selects the backing Dragonfly Reverb algorithm. */
  setReverbAlgorithm(algorithm: string): void {
    const index = ALGORITHM_INDEX[algorithm as ReverbAlgorithm]
    this.param('reverbAlgorithm').setValueAtTime(
      index >= 0 ? index : 0,
      this.node.context.currentTime,
    )
  }

  getReverbAlgorithm(): ReverbAlgorithm {
    const index = Math.round(this.param('reverbAlgorithm').value)
    return ALGORITHMS[index] ?? ALGORITHMS[0]
  }

  /** Decay length, [0, 0.97] - matches Freeverb's own roomSize range/semantics. */
  setRoomSize(size: number): void {
    this.param('roomSize').setValueAtTime(size, this.node.context.currentTime)
  }

  /** High-frequency damping, [0, 1] - matches Freeverb's own semantics. */
  setDamping(damping: number): void {
    this.param('damping').setValueAtTime(damping, this.node.context.currentTime)
  }

  /** Stereo width, [50, 150]%. */
  setWidth(width: number): void {
    this.param('width').setValueAtTime(width, this.node.context.currentTime)
  }

  /** Pre-delay, [0, 100]ms. */
  setPredelay(predelay: number): void {
    this.param('predelay').setValueAtTime(predelay, this.node.context.currentTime)
  }

  /** Modulation rate, [0, 10]Hz. */
  setSpin(spin: number): void {
    this.param('spin').setValueAtTime(spin, this.node.context.currentTime)
  }

  /** Modulation depth, [0, 40]ms. */
  setWander(wander: number): void {
    this.param('wander').setValueAtTime(wander, this.node.context.currentTime)
  }

  /** Early-reflections send level, [0, 100]%. */
  setEarlySend(earlySend: number): void {
    this.param('earlySend').setValueAtTime(earlySend, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`DragonflyReverb: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      reverbAlgorithm: this.getReverbAlgorithm(),
      roomSize: this.param('roomSize').value,
      damping: this.param('damping').value,
      width: this.param('width').value,
      predelay: this.param('predelay').value,
      spin: this.param('spin').value,
      wander: this.param('wander').value,
      earlySend: this.param('earlySend').value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.reverbAlgorithm === 'string') this.setReverbAlgorithm(params.reverbAlgorithm)
    this.applyBaseParams(params)
    if (typeof params.roomSize === 'number') this.setRoomSize(params.roomSize)
    if (typeof params.damping === 'number') this.setDamping(params.damping)
    if (typeof params.width === 'number') this.setWidth(params.width)
    if (typeof params.predelay === 'number') this.setPredelay(params.predelay)
    if (typeof params.spin === 'number') this.setSpin(params.spin)
    if (typeof params.wander === 'number') this.setWander(params.wander)
    if (typeof params.earlySend === 'number') this.setEarlySend(params.earlySend)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
