import { BaseEffect } from './Effect'

const PROCESSOR_NAME = 'noise-gate-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    const url = new URL('./noiseGateWorklet.js', import.meta.url)
    promise = context.audioWorklet.addModule(url)
    registeredContexts.set(context, promise)
  }
  return promise
}

export class NoiseGate extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'Noise Gate', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<NoiseGate> {
    await ensureWorkletRegistered(context)
    const node = new AudioWorkletNode(context, PROCESSOR_NAME)
    return new NoiseGate(context, node)
  }

  /** Threshold in dBFS below which the gate closes. Typical range: -60..-20. */
  setThreshold(dB: number): void {
    this.node.parameters.get('threshold')?.setValueAtTime(dB, this.node.context.currentTime)
  }

  /** Seconds to open once the signal crosses the threshold. */
  setAttack(seconds: number): void {
    this.node.parameters.get('attack')?.setValueAtTime(seconds, this.node.context.currentTime)
  }

  /** Seconds to close once the signal drops back below the threshold. */
  setRelease(seconds: number): void {
    this.node.parameters.get('release')?.setValueAtTime(seconds, this.node.context.currentTime)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
