import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'dragonfly-reverb-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
// Fetched once per context, shared across every Reverb instance in it - each
// gets its own WebAssembly.instantiate() (own memory), just from the same
// bytes, since AudioWorkletGlobalScope doesn't reliably expose fetch() (see
// dragonflyReverbWorklet.js's own comment).
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    // Public asset, not a co-located source file - see
    // apps/web/public/wasm-core/dragonflyReverbWorklet.js's own doc comment
    // for why it and nam_studio_core.js/.wasm live outside src/.
    promise = context.audioWorklet.addModule('/wasm-core/dragonflyReverbWorklet.js')
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
 * Real Dragonfly Hall Reverb (via packages/core compiled to WASM - see
 * scripts/build-core-wasm.sh) behind the exact same 2-knob interface the
 * app's original Freeverb.ts exposed, so it's a drop-in swap in
 * effectRegistry.ts: same `kind`/`getParams()`/`setParams()` shape, zero
 * changes needed to paramSchema.ts, EffectParamsPanel, or saved presets.
 * Freeverb.ts itself stays in the tree, unused, as the fallback issue #22's
 * own migration plan calls for.
 */
export class DragonflyReverb extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'reverb', 'Reverb', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<DragonflyReverb> {
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
    return new DragonflyReverb(context, node)
  }

  /** Decay length, [0, 0.97] - matches Freeverb's own roomSize range/semantics (higher rings out longer). */
  setRoomSize(size: number): void {
    this.param('roomSize').setValueAtTime(size, this.node.context.currentTime)
  }

  /** High-frequency damping in the tail, [0, 1] - higher = darker decay, matching Freeverb's own semantics. */
  setDamping(damping: number): void {
    this.param('damping').setValueAtTime(damping, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`DragonflyReverb: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    return {
      ...this.baseParams(),
      roomSize: this.param('roomSize').value,
      damping: this.param('damping').value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.roomSize === 'number') this.setRoomSize(params.roomSize)
    if (typeof params.damping === 'number') this.setDamping(params.damping)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
