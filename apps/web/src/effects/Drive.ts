import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'drive-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
// Fetched once per context, shared across every Drive instance in it (and
// independently of DragonflyReverb.ts's own cache of the same bytes, since
// each effect class owns its private registration/bytes cache - same
// per-file pattern NoiseGate.ts already uses) - each instance gets its own
// WebAssembly.instantiate() (own memory), just from the same bytes, since
// AudioWorkletGlobalScope doesn't reliably expose fetch() (see
// driveWorklet.js's shared base, namStudioEffectBase.js).
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

const DIODE_TYPES = ['GZ34', '1N34', '1N4148'] as const
type DiodeType = (typeof DIODE_TYPES)[number]

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
    // Public asset, not a co-located source file - see
    // apps/web/public/wasm-core/namStudioEffectBase.js's own doc comment.
    promise = context.audioWorklet.addModule('/wasm-core/driveWorklet.js')
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
 * Real Diode Clipper (BYOD's wave digital filter diode-clipper circuit, via
 * packages/core compiled to WASM) - the app's first distortion/drive
 * effect; there's no prior hand-rolled implementation this replaces. Params
 * pass straight through to Diode Clipper's own native units/ranges - no
 * legacy effect's knob semantics to preserve, unlike Reverb's roomSize/
 * damping. `diodeType` is a genuine discrete choice, so it's the app's
 * first real consumer of paramSchema's `SelectField`/`control: 'select'`
 * (already fully rendered by EffectParamsPanel.tsx, just never had one).
 */
export class Drive extends BaseEffect {
  private readonly node: AudioWorkletNode

  private constructor(context: AudioContext, node: AudioWorkletNode) {
    super(context, 'drive', 'Drive', node, node)
    this.node = node
  }

  static async create(context: AudioContext): Promise<Drive> {
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
    return new Drive(context, node)
  }

  /** RC lowpass cutoff, [200, 20000]Hz - Diode Clipper's own native range/units. */
  setCutoff(cutoff: number): void {
    this.param('cutoff').setValueAtTime(cutoff, this.node.context.currentTime)
  }

  /** Input drive amount, [0, 1] - Diode Clipper's own native range/units. */
  setDrive(drive: number): void {
    this.param('drive').setValueAtTime(drive, this.node.context.currentTime)
  }

  /** Diode type - GZ34, 1N34, or 1N4148 (each has a different clipping character). */
  setDiodeType(diodeType: string): void {
    const index = DIODE_TYPES.indexOf(diodeType as DiodeType)
    this.param('diodeType').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  /** Series diode count, [0.3, 3] - Diode Clipper's own native range/units. */
  setNumDiodes(numDiodes: number): void {
    this.param('numDiodes').setValueAtTime(numDiodes, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Drive: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    const diodeTypeIndex = Math.round(this.param('diodeType').value)
    return {
      ...this.baseParams(),
      cutoff: this.param('cutoff').value,
      drive: this.param('drive').value,
      diodeType: DIODE_TYPES[diodeTypeIndex] ?? DIODE_TYPES[0],
      numDiodes: this.param('numDiodes').value,
    }
  }

  setParams(params: EffectParams): void {
    this.applyBaseParams(params)
    if (typeof params.cutoff === 'number') this.setCutoff(params.cutoff)
    if (typeof params.drive === 'number') this.setDrive(params.drive)
    if (typeof params.diodeType === 'string') this.setDiodeType(params.diodeType)
    if (typeof params.numDiodes === 'number') this.setNumDiodes(params.numDiodes)
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
