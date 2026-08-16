import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'flanger-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/flangerWorklet.js')
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
 * Classic stereo flanger (packages/core/src/dsp/flanger.cpp compiled to
 * WASM): a modulated delay line with strong feedback creating the signature
 * comb-filter sweep ("jet plane") effect.
 */
export class Flanger extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'flanger', 'Flanger', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Flanger> {
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
    return new Flanger(context, node)
  }

  setRate(rate: number): void {
    this.param('rate').setValueAtTime(rate, this.node.context.currentTime)
  }

  setDepth(depth: number): void {
    this.param('depth').setValueAtTime(depth, this.node.context.currentTime)
  }

  setFeedback(feedback: number): void {
    this.param('feedback').setValueAtTime(feedback, this.node.context.currentTime)
  }

  setDelay(delay: number): void {
    this.param('delay').setValueAtTime(delay, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Flanger: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      rate: this.param('rate').value,
      depth: this.param('depth').value,
      feedback: this.param('feedback').value,
      delay: this.param('delay').value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
    if (typeof params.delay === 'number') this.setDelay(params.delay)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
