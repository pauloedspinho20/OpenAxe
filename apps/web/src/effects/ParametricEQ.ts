import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'eq-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

const BAND_COUNT = 4

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/eqWorklet.js')
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
 * 4-band parametric EQ compiled to WASM (packages/core/src/dsp/equalizer.cpp,
 * DSPark): low-shelf, two mid peaks, high-shelf, each with frequency/gain/Q -
 * the same band layout the old BiquadFilterNode chain used, now running in
 * the shared C++ DSP core. Band types are fixed by the wrapper (see
 * equalizer.cpp's kBandType); only the per-band frequency/gain/Q knobs are
 * exposed.
 */
export class ParametricEQ extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'eq', 'EQ', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<ParametricEQ> {
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
    return new ParametricEQ(context, node)
  }

  get bandCount(): number {
    return BAND_COUNT
  }

  setBandFrequency(index: number, hz: number): void {
    this.param(`band${index}_frequency`).setValueAtTime(hz, this.node.context.currentTime)
  }

  setBandGain(index: number, dB: number): void {
    this.param(`band${index}_gain`).setValueAtTime(dB, this.node.context.currentTime)
  }

  setBandQ(index: number, q: number): void {
    this.param(`band${index}_q`).setValueAtTime(q, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`ParametricEQ: unknown AudioParam '${name}'`)
    return param
  }

  /**
   * Flattened per-band keys (`band0_frequency`, `band0_gain`, `band0_q`, `band1_...`) rather than
   * a nested structure, since EffectParams is a flat record shared by every effect kind.
   */
  getParams(): EffectParams {
    const params: EffectParams = { bandCount: BAND_COUNT }
    for (let i = 0; i < BAND_COUNT; i++) {
      params[`band${i}_frequency`] = this.param(`band${i}_frequency`).value
      params[`band${i}_gain`] = this.param(`band${i}_gain`).value
      params[`band${i}_q`] = this.param(`band${i}_q`).value
    }
    return params
  }

  setParams(params: EffectParams): void {
    for (let i = 0; i < BAND_COUNT; i++) {
      const frequency = params[`band${i}_frequency`]
      const gain = params[`band${i}_gain`]
      const q = params[`band${i}_q`]
      if (typeof frequency === 'number') this.setBandFrequency(i, frequency)
      if (typeof gain === 'number') this.setBandGain(i, gain)
      if (typeof q === 'number') this.setBandQ(i, q)
    }
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
