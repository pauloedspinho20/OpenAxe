import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'tremolo-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

// Matches dspark::Tremolo<float>::Shape in tremolo.cpp's kParamInfo
// (shape param maps 0-2): Sine, Triangle, Square.
const SHAPES = ['sine', 'triangle', 'square'] as const
type TremoloShape = (typeof SHAPES)[number]
const SHAPE_INDEX: Record<TremoloShape, number> = {
  sine: 0,
  triangle: 1,
  square: 2,
}

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/tremoloWorklet.js')
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
 * DSPark stereo tremolo compiled to WASM (packages/core/src/dsp/tremolo.cpp):
 * rate/depth/shape (Sine/Triangle/Square), with the right channel's LFO
 * 180°-offset from the left for the classic slow auto-pan wobble.
 */
export class Tremolo extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'tremolo', 'Tremolo', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Tremolo> {
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
    return new Tremolo(context, node)
  }

  /** Wobble speed in Hz. */
  setRate(hz: number): void {
    this.param('rate').setValueAtTime(hz, this.node.context.currentTime)
  }

  /** How far volume dips on each cycle, [0, 1]. 0 = no effect, 1 = full silence at the trough. */
  setDepth(depth: number): void {
    this.param('depth').setValueAtTime(depth, this.node.context.currentTime)
  }

  /** Selects the LFO waveform: 'sine' | 'triangle' | 'square'. */
  setShape(shape: string): void {
    const index = SHAPE_INDEX[shape as TremoloShape]
    this.param('shape').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  getShape(): TremoloShape {
    const index = Math.round(this.param('shape').value)
    return SHAPES[index] ?? SHAPES[0]
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Tremolo: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      rate: this.param('rate').value,
      depth: this.param('depth').value,
      shape: this.getShape(),
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
    if (typeof params.shape === 'string') this.setShape(params.shape)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
