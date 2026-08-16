import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'noise-gate-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/noiseGateWorklet.js')
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
 * DSPark noise gate compiled to WASM (packages/core/src/dsp/noise_gate.cpp):
 * threshold/hysteresis/attack/hold/release/range, replacing the old
 * hand-rolled src/effects/noiseGateWorklet.js envelope follower. Envelope
 * times are in milliseconds (the DSP core's unit).
 */
export class NoiseGate extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'noise-gate', 'Noise Gate', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<NoiseGate> {
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
    return new NoiseGate(context, node)
  }

  /** dBFS below which the gate starts to close. Typical range: -80..0. */
  setThreshold(dB: number): void {
    this.param('threshold').setValueAtTime(dB, this.node.context.currentTime)
  }

  /** dB of hysteresis separating the open and close thresholds. */
  setHysteresis(dB: number): void {
    this.param('hysteresis').setValueAtTime(dB, this.node.context.currentTime)
  }

  /** Milliseconds to open once the signal crosses the threshold. */
  setAttack(ms: number): void {
    this.param('attack').setValueAtTime(ms, this.node.context.currentTime)
  }

  /** Milliseconds the gate stays fully open after the signal drops. */
  setHold(ms: number): void {
    this.param('hold').setValueAtTime(ms, this.node.context.currentTime)
  }

  /** Milliseconds to close once the signal drops back below the threshold. */
  setRelease(ms: number): void {
    this.param('release').setValueAtTime(ms, this.node.context.currentTime)
  }

  /** dB of attenuation applied when the gate is closed (range). */
  setRange(dB: number): void {
    this.param('range').setValueAtTime(dB, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`NoiseGate: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      threshold: this.param('threshold').value,
      hysteresis: this.param('hysteresis').value,
      attack: this.param('attack').value,
      hold: this.param('hold').value,
      release: this.param('release').value,
      range: this.param('range').value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.threshold === 'number') this.setThreshold(params.threshold)
    if (typeof params.hysteresis === 'number') this.setHysteresis(params.hysteresis)
    if (typeof params.attack === 'number') this.setAttack(params.attack)
    if (typeof params.hold === 'number') this.setHold(params.hold)
    if (typeof params.release === 'number') this.setRelease(params.release)
    if (typeof params.range === 'number') this.setRange(params.range)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
