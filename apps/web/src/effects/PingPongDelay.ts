import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'ping-pong-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/pingPongWorklet.js')
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
 * Stereo ping-pong delay (packages/core/src/dsp/ping_pong_delay.cpp compiled
 * to WASM): two delay lines alternating left/right per repeat with a tone
 * filter in the feedback path.
 */
export class PingPongDelay extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'ping-pong-delay', 'Ping-Pong Delay', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<PingPongDelay> {
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
    return new PingPongDelay(context, node)
  }

  setTime(ms: number): void {
    this.param('time').setValueAtTime(ms, this.node.context.currentTime)
  }

  setFeedback(amount: number): void {
    this.param('feedback').setValueAtTime(amount, this.node.context.currentTime)
  }

  setTone(hz: number): void {
    this.param('tone').setValueAtTime(hz, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`PingPongDelay: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      time: this.param('time').value,
      feedback: this.param('feedback').value,
      tone: this.param('tone').value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.time === 'number') this.setTime(params.time)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
    if (typeof params.tone === 'number') this.setTone(params.tone)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
