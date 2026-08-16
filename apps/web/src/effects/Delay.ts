import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'delay-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

const DELAY_MODELS = ['digital', 'analog', 'tape'] as const
type DelayModel = (typeof DELAY_MODELS)[number]
const DELAY_MODEL_INDEX: Record<DelayModel, number> = { digital: 0, analog: 1, tape: 2 }

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/delayWorklet.js')
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
 * Stereo delay with 3 character models (packages/core/src/dsp/delay.cpp
 * compiled to WASM):
 *   Digital — clean pristine repeats
 *   Analog  — BBD-style: heavier lowpass + soft saturation in feedback path
 *   Tape    — Analog + wow/flutter pitch modulation on the read tap
 *
 * The `delayModel` AudioParam switches between models; Tape adds wow depth
 * and rate controls that are ignored in other modes.
 */
export class Delay extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'delay', 'Delay', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Delay> {
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
    return new Delay(context, node)
  }

  setDelayModel(model: string): void {
    const index = DELAY_MODEL_INDEX[model as DelayModel]
    this.param('delayModel').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  getDelayModel(): DelayModel {
    const index = Math.round(this.param('delayModel').value)
    return DELAY_MODELS[index] ?? DELAY_MODELS[0]
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

  setWowDepth(ms: number): void {
    this.param('wowDepth').setValueAtTime(ms, this.node.context.currentTime)
  }

  setWowRate(hz: number): void {
    this.param('wowRate').setValueAtTime(hz, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Delay: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      delayModel: this.getDelayModel(),
      time: this.param('time').value,
      feedback: this.param('feedback').value,
      tone: this.param('tone').value,
      wowDepth: this.param('wowDepth').value,
      wowRate: this.param('wowRate').value,
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.delayModel === 'string') this.setDelayModel(params.delayModel)
    if (typeof params.time === 'number') this.setTime(params.time)
    if (typeof params.feedback === 'number') this.setFeedback(params.feedback)
    if (typeof params.tone === 'number') this.setTone(params.tone)
    if (typeof params.wowDepth === 'number') this.setWowDepth(params.wowDepth)
    if (typeof params.wowRate === 'number') this.setWowRate(params.wowRate)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
