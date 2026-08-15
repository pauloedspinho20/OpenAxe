import { BaseEffect, type EffectParams } from './Effect'

const PROCESSOR_NAME = 'drive-processor'
const registeredContexts = new WeakMap<BaseAudioContext, Promise<void>>()
const wasmBytesByContext = new WeakMap<BaseAudioContext, Promise<ArrayBuffer>>()

const DIODE_TYPES = ['GZ34', '1N34', '1N4148'] as const
type DiodeType = (typeof DIODE_TYPES)[number]

const DRIVE_MODELS = ['diode-clipper', 'tube-screamer', 'zen-drive', 'mxr-distortion'] as const
type DriveModel = (typeof DRIVE_MODELS)[number]
const DRIVE_MODEL_INDEX: Record<DriveModel, number> = {
  'diode-clipper': 0,
  'tube-screamer': 1,
  'zen-drive': 2,
  'mxr-distortion': 3,
}

function ensureWorkletRegistered(context: AudioContext): Promise<void> {
  let promise = registeredContexts.get(context)
  if (!promise) {
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
 * Four BYOD wave-digital-filter circuit models compiled to WASM from
 * packages/core: Diode Clipper, Tube Screamer, Zen Drive, MXR Distortion+.
 * The `driveModel` AudioParam selects which model backs the block; each model
 * exposes its own native parameters (see driveWorklet.js for the index
 * mapping). Model switching reconstructs the DSP wrapper — not real-time
 * safe, but model choice is a user action, not an automation curve.
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

  /** Selects the backing BYOD circuit model. */
  setDriveModel(model: string): void {
    const index = DRIVE_MODEL_INDEX[model as DriveModel]
    this.param('driveModel').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  /** Returns the current model's kind string (e.g. "tube-screamer"). */
  getDriveModel(): DriveModel {
    const index = Math.round(this.param('driveModel').value)
    return DRIVE_MODELS[index] ?? DRIVE_MODELS[0]
  }

  // ── Diode Clipper params (model 0) ──

  setCutoff(cutoff: number): void {
    this.param('cutoff').setValueAtTime(cutoff, this.node.context.currentTime)
  }

  setDrive(drive: number): void {
    this.param('drive').setValueAtTime(drive, this.node.context.currentTime)
  }

  // ── Shared params (Diode Clipper + Tube Screamer) ──

  setDiodeType(diodeType: string): void {
    const index = DIODE_TYPES.indexOf(diodeType as DiodeType)
    this.param('diodeType').setValueAtTime(index >= 0 ? index : 0, this.node.context.currentTime)
  }

  setNumDiodes(numDiodes: number): void {
    this.param('numDiodes').setValueAtTime(numDiodes, this.node.context.currentTime)
  }

  // ── Tube Screamer / Zen Drive shared gain ──

  setGain(gain: number): void {
    this.param('gain').setValueAtTime(gain, this.node.context.currentTime)
  }

  // ── Zen Drive voice ──

  setVoice(voice: number): void {
    this.param('voice').setValueAtTime(voice, this.node.context.currentTime)
  }

  // ── MXR Distortion params ──

  setDist(dist: number): void {
    this.param('dist').setValueAtTime(dist, this.node.context.currentTime)
  }

  setOutputLevel(outputLevel: number): void {
    this.param('outputLevel').setValueAtTime(outputLevel, this.node.context.currentTime)
  }

  private param(name: string): AudioParam {
    const param = this.node.parameters.get(name)
    if (!param) throw new Error(`Drive: unknown AudioParam '${name}'`)
    return param
  }

  getParams(): EffectParams {
    const model = this.getDriveModel()
    const diodeTypeIndex = Math.round(this.param('diodeType').value)
    const base: EffectParams = {
      ...this.baseParams(),
      driveModel: model,
    }
    switch (model) {
      case 'diode-clipper':
        return {
          ...base,
          cutoff: this.param('cutoff').value,
          drive: this.param('drive').value,
          diodeType: DIODE_TYPES[diodeTypeIndex] ?? DIODE_TYPES[0],
          numDiodes: this.param('numDiodes').value,
        }
      case 'tube-screamer':
        return {
          ...base,
          gain: this.param('gain').value,
          diodeType: DIODE_TYPES[diodeTypeIndex] ?? DIODE_TYPES[0],
          numDiodes: this.param('numDiodes').value,
        }
      case 'zen-drive':
        return {
          ...base,
          voice: this.param('voice').value,
          gain: this.param('gain').value,
        }
      case 'mxr-distortion':
        return {
          ...base,
          dist: this.param('dist').value,
          outputLevel: this.param('outputLevel').value,
        }
    }
  }

  setParams(params: EffectParams): void {
    if (typeof params.driveModel === 'string') this.setDriveModel(params.driveModel)
    this.applyBaseParams(params)
    const model = this.getDriveModel()
    switch (model) {
      case 'diode-clipper':
        if (typeof params.cutoff === 'number') this.setCutoff(params.cutoff)
        if (typeof params.drive === 'number') this.setDrive(params.drive)
        if (typeof params.diodeType === 'string') this.setDiodeType(params.diodeType)
        if (typeof params.numDiodes === 'number') this.setNumDiodes(params.numDiodes)
        break
      case 'tube-screamer':
        if (typeof params.gain === 'number') this.setGain(params.gain)
        if (typeof params.diodeType === 'string') this.setDiodeType(params.diodeType)
        if (typeof params.numDiodes === 'number') this.setNumDiodes(params.numDiodes)
        break
      case 'zen-drive':
        if (typeof params.voice === 'number') this.setVoice(params.voice)
        if (typeof params.gain === 'number') this.setGain(params.gain)
        break
      case 'mxr-distortion':
        if (typeof params.dist === 'number') this.setDist(params.dist)
        if (typeof params.outputLevel === 'number') this.setOutputLevel(params.outputLevel)
        break
    }
  }

  dispose(): void {
    this.disposeBase()
    this.node.disconnect()
  }
}
