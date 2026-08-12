import { BaseEffect } from './Effect'

/**
 * Wraps the native DynamicsCompressorNode - it already exposes the standard
 * threshold/knee/ratio/attack/release controls with a solid built-in
 * implementation, so there's no need to port a third-party compressor.
 */
export class Compressor extends BaseEffect {
  private readonly node: DynamicsCompressorNode

  constructor(context: BaseAudioContext) {
    const node = new DynamicsCompressorNode(context)
    super(context, 'Compressor', node, node)
    this.node = node
  }

  /** dBFS at which compression begins. */
  setThreshold(dB: number): void {
    this.node.threshold.setTargetAtTime(dB, this.node.context.currentTime, 0.01)
  }

  /** dB range above the threshold over which the ratio increases gradually. */
  setKnee(dB: number): void {
    this.node.knee.setTargetAtTime(dB, this.node.context.currentTime, 0.01)
  }

  /** Input/output ratio above the threshold, e.g. 4 = 4:1. */
  setRatio(ratio: number): void {
    this.node.ratio.setTargetAtTime(ratio, this.node.context.currentTime, 0.01)
  }

  setAttack(seconds: number): void {
    this.node.attack.setTargetAtTime(seconds, this.node.context.currentTime, 0.01)
  }

  setRelease(seconds: number): void {
    this.node.release.setTargetAtTime(seconds, this.node.context.currentTime, 0.01)
  }

  /** Current gain reduction in dB (negative), for a UI meter. */
  getReductionDb(): number {
    return this.node.reduction
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
