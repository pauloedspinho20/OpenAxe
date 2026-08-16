import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'phaser-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/phaserWorklet.js')
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
 * Classic feedback phaser (packages/core/src/dsp/phaser.cpp compiled to
 * WASM): a cascade of LFO-swept first-order all-pass filters with feedback
 * for resonant notch sweeps. The `stages` param sets the number of all-pass
 * stages (2–8).
 */
export class Phaser extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'phaser', 'Phaser', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Phaser> {
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
    return new Phaser(context, node)
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

  setStages(stages: number): void {
    this.param('stages').setValueAtTime(stages, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Phaser: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      rate: this.param('rate').value,
      depth: this.param('depth').value,
      feedback: this.param('feedback').value,
      stages: this.param('stages').value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.rate === 'number') this.setRate(params.rate)
    if (typeof params.depth === 'number') this.setDepth(params.depth)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
    if (typeof params.stages === 'number') this.setStages(params.stages)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
