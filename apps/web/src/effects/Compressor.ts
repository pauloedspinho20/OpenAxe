import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'compressor-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    promise = context.audioWorklet.addModule('/wasm-core/compressorWorklet.js')
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

// Matches dspark::Compressor<float>::Character in compressor.cpp's kParamInfo
// (character param maps 0-3): Clean, Opto, FET, Varimu.
const CHARACTERS = ['clean', 'opto', 'fet', 'varimu'] as const
type Character = (typeof CHARACTERS)[number]
const CHARACTER_INDEX: Record<Character, number> = {
  clean: 0,
  opto: 1,
  fet: 2,
  varimu: 3,
}

/**
 * DSPark compressor compiled to WASM (packages/core/src/dsp/compressor.cpp):
 * threshold/ratio/attack/release with a knee, manual makeup gain, and four
 * character models (Clean/Opto/FET/Varimu) that re-voice the detector
 * ballistics the way the named hardware lines do. Envelope times are in
 * milliseconds (the DSP core's unit), not seconds like the old native
 * DynamicsCompressorNode wrapper.
 */
export class Compressor extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'compressor', 'Compressor', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Compressor> {
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
    return new Compressor(context, node)
  }

  /** dBFS at which compression begins. */
  setThreshold(dB: number): void {
    this.param('threshold').setValueAtTime(dB, this.node.context.currentTime)
  }

  /** Input/output ratio above the threshold, e.g. 4 = 4:1. */
  setRatio(ratio: number): void {
    this.param('ratio').setValueAtTime(ratio, this.node.context.currentTime)
  }

  /** Attack time in milliseconds. */
  setAttack(ms: number): void {
    this.param('attack').setValueAtTime(ms, this.node.context.currentTime)
  }

  /** Release time in milliseconds. */
  setRelease(ms: number): void {
    this.param('release').setValueAtTime(ms, this.node.context.currentTime)
  }

  /** dB range above the threshold over which the ratio increases gradually. */
  setKnee(dB: number): void {
    this.param('knee').setValueAtTime(dB, this.node.context.currentTime)
  }

  /** Manual output makeup gain in dB. */
  setMakeupGain(dB: number): void {
    this.param('makeup_gain').setValueAtTime(dB, this.node.context.currentTime)
  }

  /** Selects the detector character model: 'clean' | 'opto' | 'fet' | 'varimu'. */
  setCharacter(character: string): void {
    const index = CHARACTER_INDEX[character as Character]
    this.param('character').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  getCharacter(): Character {
    const index = Math.round(this.param('character').value)
    return CHARACTERS[index] ?? CHARACTERS[0]
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Compressor: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      threshold: this.param('threshold').value,
      ratio: this.param('ratio').value,
      attack: this.param('attack').value,
      release: this.param('release').value,
      knee: this.param('knee').value,
      makeup_gain: this.param('makeup_gain').value,
      character: this.getCharacter(),
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.threshold === 'number') this.setThreshold(params.threshold)
    if (typeof params.ratio === 'number') this.setRatio(params.ratio)
    if (typeof params.attack === 'number') this.setAttack(params.attack)
    if (typeof params.release === 'number') this.setRelease(params.release)
    if (typeof params.knee === 'number') this.setKnee(params.knee)
    if (typeof params.makeup_gain === 'number') this.setMakeupGain(params.makeup_gain)
    if (typeof params.character === 'string') this.setCharacter(params.character)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
