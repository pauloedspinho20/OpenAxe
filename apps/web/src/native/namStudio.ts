/**
 * Typed wrapper around the desktop shell's `window.namStudio.*` bridge (issue
 * #15 M2). The C++ side exposes one global function per method (webview::bind
 * with dotted names, e.g. `window['namStudio.addBlock']`), each taking a
 * single object argument and resolving a Promise with JSON.
 *
 * `getNamStudio()` returns null when the bridge isn't present, so the same
 * module can live in the web build (where it's absent) and the desktop build
 * (where the shell injects it). NativeGraphRig and the native useAudioEngine
 * build on this.
 *
 * Method/argument names mirror the C++ handlers in apps/desktop/src/bridge.cpp
 * exactly. Block/edge ids are the web app's strings; rail jacks are the
 * numbers -1 (IN) / -2 (OUT).
 */

export interface NamStudioDevice {
  id: number
  name: string
  api: string
  isDefault: boolean
  inputChannels: number
  outputChannels: number
  preferredSampleRate: number
  isInput: boolean
  isOutput: boolean
}

export interface NamStudioConfig {
  ok: boolean
  open: boolean
  running: boolean
  sampleRate: number
  bufferFrames: number
  /** Device round-trip latency the audio backend reports, in frames; -1 when
   * unknown or nothing is open. */
  latencyFrames: number
  /** Same figure in milliseconds, or -1 when unknown. */
  latencyMs: number
  lastError: string
  cpuLoad: number
}

export interface NamStudioBlockParam {
  index: number
  name: string
  symbol: string
  min: number
  max: number
  unit: string
  value: number
}

export interface NamStudioBlockInfo {
  ok: boolean
  id: string
  kind: string
  row: number
  col: number
  hasModel: boolean
  paramCount: number
  params: NamStudioBlockParam[]
  meter: number
}

export interface NamStudioBlockRecord {
  id: string
  kind: string
  row: number
  col: number
}

export interface NamStudioJack {
  id: number | string
  port: number
}

export interface NamStudioEdgeRecord {
  id: string
  from: NamStudioJack
  to: NamStudioJack
}

export interface NamStudioOk {
  ok: boolean
  error?: string
}

export interface NamStudioOpenResult extends NamStudioOk {
  /** What the backend actually granted, which can differ from the request. */
  sampleRate?: number
  bufferFrames?: number
  /** Device round-trip latency in frames / ms, -1 when the backend can't report it. */
  latencyFrames?: number
  latencyMs?: number
}

export interface NamStudioIdResult extends NamStudioOk {
  id?: string
}

export interface NamStudioGetParamResult extends NamStudioOk {
  value?: number
}

export interface NamStudioLoadModelResult extends NamStudioOk {
  result?: number
  canceled?: boolean
}

export interface NamStudioTap {
  l: number[]
  r: number[]
  frames: number
}

export interface NamStudioBridge {
  version(): Promise<string>
  listDevices(): Promise<NamStudioDevice[]>
  getConfig(): Promise<NamStudioConfig>
  open(args: {
    inputDeviceId?: number
    outputDeviceId?: number
    sampleRate?: number
    /** Requested block size; the backend may grant a different one. Pass 0 for
     * the smallest block the device supports (lowest possible round-trip -
     * a heavy NAM model can overrun it, so it is an explicit choice). */
    bufferFrames?: number
  }): Promise<NamStudioOpenResult>
  close(): Promise<NamStudioOk>
  start(): Promise<NamStudioOk>
  stop(): Promise<NamStudioOk>

  addBlock(args: {
    kind: string
    row: number
    col: number
    id?: string
  }): Promise<NamStudioIdResult>
  removeBlock(args: { blockId: string }): Promise<NamStudioOk>
  moveBlock(args: { blockId: string; row: number; col: number }): Promise<NamStudioOk>
  connect(args: {
    fromId: number | string
    fromPort?: number
    toId: number | string
    toPort?: number
    id?: string
  }): Promise<NamStudioIdResult>
  disconnect(args: { edgeId: string }): Promise<NamStudioOk>
  setParam(args: { blockId: string; key: number | string; value: number }): Promise<NamStudioOk>
  getParam(args: { blockId: string; key: number | string }): Promise<NamStudioGetParamResult>
  blockInfo(args: { blockId: string }): Promise<NamStudioBlockInfo>
  listBlocks(): Promise<NamStudioBlockRecord[]>
  listEdges(): Promise<NamStudioEdgeRecord[]>

  loadModel(args: { blockId: string }): Promise<NamStudioLoadModelResult>
  loadModelJson(args: { blockId: string; json: string }): Promise<NamStudioLoadModelResult>
  unloadModel(args: { blockId: string }): Promise<NamStudioOk>
  setReverbAlgorithm(args: { blockId: string; algorithm: string }): Promise<NamStudioOk>
  setDelayModel(args: { blockId: string; model: string }): Promise<NamStudioOk>

  setBypass(args: { blockId: string; bypassed: boolean }): Promise<NamStudioOk>
  /** Per-block Input/Output trim (1 = unity). Omitted keys are left alone.
   * Not the same thing as the Amp family's `input_level`/`output_level`
   * params, which carry the loaded NAM model's dBu calibration. */
  setBlockTrim(args: { blockId: string; input?: number; output?: number }): Promise<NamStudioOk>
  /** Install a cab IR from the bytes of a WAV file, base64-encoded (binary can't
   * cross the webview bridge). The core decodes and resamples it and reports how
   * many samples it installed. */
  loadIrWav(args: {
    blockId: string
    wavBase64: string
  }): Promise<NamStudioOk & { frames?: number }>
  unloadIr(args: { blockId: string }): Promise<NamStudioOk>
  /** Input TRIM applied before the graph and the monitor taps, 1 = unity -
   * the native counterpart of the web engine's input GainNode. */
  setInputGain(args: { gain: number }): Promise<NamStudioOk>
  setMasterLevel(args: { level: number }): Promise<NamStudioOk>
  setMasterMuted(args: { muted: boolean }): Promise<NamStudioOk>
  setTunerMuted(args: { muted: boolean }): Promise<NamStudioOk>

  meters(): Promise<Array<{ id: string; value: number }>>
  cpuLoad(): Promise<number>
  getTap(args: { side: 'in' | 'out'; frames?: number }): Promise<NamStudioTap>
  /** Reports (and clears) a pending RtAudio stream-level error - e.g. a
   * second process forcing a mid-stream reconfiguration on a shared device.
   * `error` is null when nothing is pending. */
  takeStreamError(): Promise<{ error: string | null }>
}

type Args = Record<string, unknown> | undefined

class NativeBridge implements NamStudioBridge {
  private readonly w: Record<string, unknown>

  constructor() {
    this.w = window as unknown as Record<string, unknown>
  }

  private call<T>(method: string, args?: Args): Promise<T> {
    const fn = this.w[`namStudio.${method}`] as ((a?: Args) => Promise<T>) | undefined
    if (typeof fn !== 'function') {
      return Promise.reject(new Error(`namStudio.${method} is unavailable`))
    }
    return fn(args)
  }

  version() {
    return this.call<string>('version')
  }
  listDevices() {
    return this.call<NamStudioDevice[]>('listDevices')
  }
  getConfig() {
    return this.call<NamStudioConfig>('getConfig')
  }
  open(args: {
    inputDeviceId?: number
    outputDeviceId?: number
    sampleRate?: number
    bufferFrames?: number
  }) {
    return this.call<NamStudioOpenResult>('open', args)
  }
  close() {
    return this.call<NamStudioOk>('close')
  }
  start() {
    return this.call<NamStudioOk>('start')
  }
  stop() {
    return this.call<NamStudioOk>('stop')
  }
  addBlock(args: { kind: string; row: number; col: number; id?: string }) {
    return this.call<NamStudioIdResult>('addBlock', args)
  }
  removeBlock(args: { blockId: string }) {
    return this.call<NamStudioOk>('removeBlock', args)
  }
  moveBlock(args: { blockId: string; row: number; col: number }) {
    return this.call<NamStudioOk>('moveBlock', args)
  }
  connect(args: {
    fromId: number | string
    fromPort?: number
    toId: number | string
    toPort?: number
    id?: string
  }) {
    return this.call<NamStudioIdResult>('connect', args)
  }
  disconnect(args: { edgeId: string }) {
    return this.call<NamStudioOk>('disconnect', args)
  }
  setParam(args: { blockId: string; key: number | string; value: number }) {
    return this.call<NamStudioOk>('setParam', args)
  }
  getParam(args: { blockId: string; key: number | string }) {
    return this.call<NamStudioGetParamResult>('getParam', args)
  }
  blockInfo(args: { blockId: string }) {
    return this.call<NamStudioBlockInfo>('blockInfo', args)
  }
  listBlocks() {
    return this.call<NamStudioBlockRecord[]>('listBlocks')
  }
  listEdges() {
    return this.call<NamStudioEdgeRecord[]>('listEdges')
  }
  loadModel(args: { blockId: string }) {
    return this.call<NamStudioLoadModelResult>('loadModel', args)
  }
  loadModelJson(args: { blockId: string; json: string }) {
    return this.call<NamStudioLoadModelResult>('loadModelJson', args)
  }
  unloadModel(args: { blockId: string }) {
    return this.call<NamStudioOk>('unloadModel', args)
  }
  setReverbAlgorithm(args: { blockId: string; algorithm: string }) {
    return this.call<NamStudioOk>('setReverbAlgorithm', args)
  }
  setDelayModel(args: { blockId: string; model: string }) {
    return this.call<NamStudioOk>('setDelayModel', args)
  }
  setBypass(args: { blockId: string; bypassed: boolean }) {
    return this.call<NamStudioOk>('setBypass', args)
  }
  setBlockTrim(args: { blockId: string; input?: number; output?: number }) {
    return this.call<NamStudioOk>('setBlockTrim', args)
  }
  loadIrWav(args: { blockId: string; wavBase64: string }) {
    return this.call<NamStudioOk & { frames?: number }>('loadIrWav', args)
  }
  unloadIr(args: { blockId: string }) {
    return this.call<NamStudioOk>('unloadIr', args)
  }
  setInputGain(args: { gain: number }) {
    return this.call<NamStudioOk>('setInputGain', args)
  }
  setMasterLevel(args: { level: number }) {
    return this.call<NamStudioOk>('setMasterLevel', args)
  }
  setMasterMuted(args: { muted: boolean }) {
    return this.call<NamStudioOk>('setMasterMuted', args)
  }
  setTunerMuted(args: { muted: boolean }) {
    return this.call<NamStudioOk>('setTunerMuted', args)
  }
  meters() {
    return this.call<Array<{ id: string; value: number }>>('meters')
  }
  cpuLoad() {
    return this.call<number>('cpuLoad')
  }
  getTap(args: { side: 'in' | 'out'; frames?: number }) {
    return this.call<NamStudioTap>('getTap', args)
  }
  takeStreamError() {
    return this.call<{ error: string | null }>('takeStreamError')
  }
}

export function getNamStudio(): NamStudioBridge | null {
  const w = window as unknown as Record<string, unknown>
  if (typeof w['namStudio.version'] !== 'function') return null
  return new NativeBridge()
}
