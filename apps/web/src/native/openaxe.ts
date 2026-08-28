/**
 * Typed wrapper around the desktop shell's `window.openAxe.*` bridge (issue
 * #15 M2). The C++ side exposes one global function per method (webview::bind
 * with dotted names, e.g. `window['openAxe.addBlock']`), each taking a
 * single object argument and resolving a Promise with JSON.
 *
 * `getOpenAxe()` returns null when the bridge isn't present, so the same
 * module can live in the web build (where it's absent) and the desktop build
 * (where the shell injects it). NativeGraphRig and the native useAudioEngine
 * build on this.
 *
 * Method/argument names mirror the C++ handlers in apps/desktop/src/bridge.cpp
 * exactly. Block/edge ids are the web app's strings; rail jacks are the
 * numbers -1 (IN) / -2 (OUT).
 */

export interface OpenAxeDevice {
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

export interface OpenAxeConfig {
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
  /** Which native shell answered. Absent on older desktop builds. */
  shell?: ShellKind
  /** False in a plugin, where the DAW owns the device. Absent on older builds;
   * prefer shellOwnsAudioDevice() for the synchronous check. */
  ownsAudioDevice?: boolean
}

/** The core's serialized rig, as returned by `openAxe.getState`. This is the
 * same document the DAW stores in its chunk, so it is the authoritative
 * description of what the C++ graph currently holds (issue #300 D1/D2). */
export interface OpenAxeCoreState {
  schemaVersion: number
  blocks: {
    id: string
    kind: string
    row: number
    col: number
    bypass?: boolean
    inputTrim?: number
    outputTrim?: number
    params?: Record<string, number>
  }[]
  edges: {
    id: string
    from: { blockId: string; port: number }
    to: { blockId: string; port: number }
  }[]
  masterLevel?: number
  masterMuted?: boolean
}

export interface OpenAxeBlockParam {
  index: number
  name: string
  symbol: string
  min: number
  max: number
  unit: string
  value: number
}

export interface OpenAxeBlockInfo {
  ok: boolean
  id: string
  kind: string
  row: number
  col: number
  hasModel: boolean
  paramCount: number
  params: OpenAxeBlockParam[]
  meter: number
}

export interface OpenAxeBlockRecord {
  id: string
  kind: string
  row: number
  col: number
}

export interface OpenAxeJack {
  id: number | string
  port: number
}

export interface OpenAxeEdgeRecord {
  id: string
  from: OpenAxeJack
  to: OpenAxeJack
}

export interface OpenAxeOk {
  ok: boolean
  error?: string
}

export interface OpenAxeOpenResult extends OpenAxeOk {
  /** What the backend actually granted, which can differ from the request. */
  sampleRate?: number
  bufferFrames?: number
  /** Device round-trip latency in frames / ms, -1 when the backend can't report it. */
  latencyFrames?: number
  latencyMs?: number
}

export interface OpenAxeIdResult extends OpenAxeOk {
  id?: string
}

export interface OpenAxeGetParamResult extends OpenAxeOk {
  value?: number
}

export interface OpenAxeLoadModelResult extends OpenAxeOk {
  result?: number
  canceled?: boolean
}

export interface OpenAxeTap {
  l: number[]
  r: number[]
  frames: number
}

export interface OpenAxeBridge {
  version(): Promise<string>
  listDevices(): Promise<OpenAxeDevice[]>
  getConfig(): Promise<OpenAxeConfig>
  open(args: {
    inputDeviceId?: number
    outputDeviceId?: number
    sampleRate?: number
    /** Requested block size; the backend may grant a different one. Pass 0 for
     * the smallest block the device supports (lowest possible round-trip -
     * a heavy NAM model can overrun it, so it is an explicit choice). */
    bufferFrames?: number
  }): Promise<OpenAxeOpenResult>
  close(): Promise<OpenAxeOk>
  start(): Promise<OpenAxeOk>
  stop(): Promise<OpenAxeOk>

  addBlock(args: { kind: string; row: number; col: number; id?: string }): Promise<OpenAxeIdResult>
  removeBlock(args: { blockId: string }): Promise<OpenAxeOk>
  moveBlock(args: { blockId: string; row: number; col: number }): Promise<OpenAxeOk>
  connect(args: {
    fromId: number | string
    fromPort?: number
    toId: number | string
    toPort?: number
    id?: string
  }): Promise<OpenAxeIdResult>
  disconnect(args: { edgeId: string }): Promise<OpenAxeOk>
  setParam(args: { blockId: string; key: number | string; value: number }): Promise<OpenAxeOk>
  getParam(args: { blockId: string; key: number | string }): Promise<OpenAxeGetParamResult>
  blockInfo(args: { blockId: string }): Promise<OpenAxeBlockInfo>
  listBlocks(): Promise<OpenAxeBlockRecord[]>
  listEdges(): Promise<OpenAxeEdgeRecord[]>

  loadModel(args: { blockId: string }): Promise<OpenAxeLoadModelResult>
  loadModelJson(args: { blockId: string; json: string }): Promise<OpenAxeLoadModelResult>
  unloadModel(args: { blockId: string }): Promise<OpenAxeOk>
  setReverbAlgorithm(args: { blockId: string; algorithm: string }): Promise<OpenAxeOk>
  setDelayModel(args: { blockId: string; model: string }): Promise<OpenAxeOk>

  setBypass(args: { blockId: string; bypassed: boolean }): Promise<OpenAxeOk>
  /** Per-block Input/Output trim (1 = unity). Omitted keys are left alone.
   * Not the same thing as the Amp family's `input_level`/`output_level`
   * params, which carry the loaded NAM model's dBu calibration. */
  setBlockTrim(args: { blockId: string; input?: number; output?: number }): Promise<OpenAxeOk>
  /** Install a cab IR from the bytes of a WAV file, base64-encoded (binary can't
   * cross the webview bridge). The core decodes and resamples it and reports how
   * many samples it installed. */
  loadIrWav(args: { blockId: string; wavBase64: string }): Promise<OpenAxeOk & { frames?: number }>
  unloadIr(args: { blockId: string }): Promise<OpenAxeOk>
  /** Input TRIM applied before the graph and the monitor taps, 1 = unity -
   * the native counterpart of the web engine's input GainNode. */
  setInputGain(args: { gain: number }): Promise<OpenAxeOk>
  setMasterLevel(args: { level: number }): Promise<OpenAxeOk>
  setMasterMuted(args: { muted: boolean }): Promise<OpenAxeOk>
  setTunerMuted(args: { muted: boolean }): Promise<OpenAxeOk>

  meters(): Promise<Array<{ id: string; value: number }>>
  cpuLoad(): Promise<number>
  getTap(args: { side: 'in' | 'out'; frames?: number }): Promise<OpenAxeTap>
  /** Reports (and clears) a pending RtAudio stream-level error - e.g. a
   * second process forcing a mid-stream reconfiguration on a shared device.
   * `error` is null when nothing is pending. */
  takeStreamError(): Promise<{ error: string | null }>
  getState(): Promise<OpenAxeOk & { state?: OpenAxeCoreState }>

  /** Small secret store (issue #146) backed by the OS keychain (macOS/
   * Windows) or a permission-restricted file (Linux, until Secret Service
   * is wired up) - see apps/desktop/src/secure_storage.h. Used to persist
   * the Tone3000 refresh token across app restarts, which the webview's own
   * storage can't do here: the UI server (and so the webview's origin)
   * binds a fresh ephemeral port every launch. `key` must be a plain
   * identifier ([A-Za-z0-9_-]+) - anything else is rejected. */
  secureStore(args: { key: string; value: string }): Promise<OpenAxeOk>
  /** `value` is null when nothing is stored under `key` - the ordinary
   * "never connected" case, not a failure (still `ok: true`). */
  secureLoad(args: { key: string }): Promise<OpenAxeOk & { value: string | null }>
  /** No-op success if there was nothing stored under `key`. */
  secureDelete(args: { key: string }): Promise<OpenAxeOk>
}

type Args = Record<string, unknown> | undefined

class NativeBridge implements OpenAxeBridge {
  private readonly w: Record<string, unknown>

  constructor() {
    this.w = window as unknown as Record<string, unknown>
  }

  private call<T>(method: string, args?: Args): Promise<T> {
    const fn = this.w[`openAxe.${method}`] as ((a?: Args) => Promise<T>) | undefined
    if (typeof fn !== 'function') {
      return Promise.reject(new Error(`openAxe.${method} is unavailable`))
    }
    return fn(args)
  }

  version() {
    return this.call<string>('version')
  }
  listDevices() {
    return this.call<OpenAxeDevice[]>('listDevices')
  }
  getConfig() {
    return this.call<OpenAxeConfig>('getConfig')
  }
  open(args: {
    inputDeviceId?: number
    outputDeviceId?: number
    sampleRate?: number
    bufferFrames?: number
  }) {
    return this.call<OpenAxeOpenResult>('open', args)
  }
  close() {
    return this.call<OpenAxeOk>('close')
  }
  start() {
    return this.call<OpenAxeOk>('start')
  }
  stop() {
    return this.call<OpenAxeOk>('stop')
  }
  addBlock(args: { kind: string; row: number; col: number; id?: string }) {
    return this.call<OpenAxeIdResult>('addBlock', args)
  }
  removeBlock(args: { blockId: string }) {
    return this.call<OpenAxeOk>('removeBlock', args)
  }
  moveBlock(args: { blockId: string; row: number; col: number }) {
    return this.call<OpenAxeOk>('moveBlock', args)
  }
  connect(args: {
    fromId: number | string
    fromPort?: number
    toId: number | string
    toPort?: number
    id?: string
  }) {
    return this.call<OpenAxeIdResult>('connect', args)
  }
  disconnect(args: { edgeId: string }) {
    return this.call<OpenAxeOk>('disconnect', args)
  }
  setParam(args: { blockId: string; key: number | string; value: number }) {
    return this.call<OpenAxeOk>('setParam', args)
  }
  getParam(args: { blockId: string; key: number | string }) {
    return this.call<OpenAxeGetParamResult>('getParam', args)
  }
  blockInfo(args: { blockId: string }) {
    return this.call<OpenAxeBlockInfo>('blockInfo', args)
  }
  listBlocks() {
    return this.call<OpenAxeBlockRecord[]>('listBlocks')
  }
  listEdges() {
    return this.call<OpenAxeEdgeRecord[]>('listEdges')
  }
  loadModel(args: { blockId: string }) {
    return this.call<OpenAxeLoadModelResult>('loadModel', args)
  }
  loadModelJson(args: { blockId: string; json: string }) {
    return this.call<OpenAxeLoadModelResult>('loadModelJson', args)
  }
  unloadModel(args: { blockId: string }) {
    return this.call<OpenAxeOk>('unloadModel', args)
  }
  setReverbAlgorithm(args: { blockId: string; algorithm: string }) {
    return this.call<OpenAxeOk>('setReverbAlgorithm', args)
  }
  setDelayModel(args: { blockId: string; model: string }) {
    return this.call<OpenAxeOk>('setDelayModel', args)
  }
  setBypass(args: { blockId: string; bypassed: boolean }) {
    return this.call<OpenAxeOk>('setBypass', args)
  }
  setBlockTrim(args: { blockId: string; input?: number; output?: number }) {
    return this.call<OpenAxeOk>('setBlockTrim', args)
  }
  loadIrWav(args: { blockId: string; wavBase64: string }) {
    return this.call<OpenAxeOk & { frames?: number }>('loadIrWav', args)
  }
  unloadIr(args: { blockId: string }) {
    return this.call<OpenAxeOk>('unloadIr', args)
  }
  setInputGain(args: { gain: number }) {
    return this.call<OpenAxeOk>('setInputGain', args)
  }
  setMasterLevel(args: { level: number }) {
    return this.call<OpenAxeOk>('setMasterLevel', args)
  }
  setMasterMuted(args: { muted: boolean }) {
    return this.call<OpenAxeOk>('setMasterMuted', args)
  }
  setTunerMuted(args: { muted: boolean }) {
    return this.call<OpenAxeOk>('setTunerMuted', args)
  }
  meters() {
    return this.call<Array<{ id: string; value: number }>>('meters')
  }
  cpuLoad() {
    return this.call<number>('cpuLoad')
  }
  getTap(args: { side: 'in' | 'out'; frames?: number }) {
    return this.call<OpenAxeTap>('getTap', args)
  }
  takeStreamError() {
    return this.call<{ error: string | null }>('takeStreamError')
  }
  /** The core's current rig. Only the plugin implements this today — the
   * desktop shell's own state lives in the same graph but the app there
   * restores from its stores as before. */
  getState() {
    return this.call<OpenAxeOk & { state?: OpenAxeCoreState }>('getState')
  }
  secureStore(args: { key: string; value: string }) {
    return this.call<OpenAxeOk>('secureStore', args)
  }
  secureLoad(args: { key: string }) {
    return this.call<OpenAxeOk & { value: string | null }>('secureLoad', args)
  }
  secureDelete(args: { key: string }) {
    return this.call<OpenAxeOk>('secureDelete', args)
  }
}

/**
 * Which native shell (if any) is hosting the React app.
 *
 * `getOpenAxe() !== null` only answers "is there a bridge?", which was enough
 * while the only bridge was the desktop shell. The VST3/CLAP/AU plugin also
 * has a bridge but does NOT own the audio device - the DAW does - so treating
 * it as "desktop" put device pickers, buffer-size controls and a power gate in
 * front of a user whose host already decided all three (issue #300 E1).
 *
 * The plugin publishes `window.openAxe.shell` from its injected bridge
 * polyfill, so this resolves synchronously at module scope, the same way
 * `isNativeShell` does - no awaiting getConfig() before the first render. The
 * desktop shell binds its handlers natively and injects no polyfill, so an
 * absent tag means desktop.
 */
export type ShellKind = 'web' | 'desktop' | 'plugin'

export function getShellKind(): ShellKind {
  if (getOpenAxe() === null) return 'web'
  const w = window as unknown as { openAxe?: { shell?: unknown } }
  return w.openAxe?.shell === 'plugin' ? 'plugin' : 'desktop'
}

/**
 * True when this shell is responsible for opening and configuring the audio
 * device. False in a plugin, where the host owns sample rate, buffer size and
 * device selection, and false on the web, where the browser does.
 *
 * This - not "is there a bridge?" - is what audio-device UI should branch on.
 */
export function shellOwnsAudioDevice(): boolean {
  return getShellKind() === 'desktop'
}

export function getOpenAxe(): OpenAxeBridge | null {
  // Not just the browser/webview-vs-native check this already was: some
  // unit tests run in a plain Node environment with no `window` global at
  // all (no @vitest-environment jsdom directive) - calling code that's
  // unconditionally reachable outside a component (e.g. client.ts's
  // setTokens/clearTokens) must not throw there either.
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  if (typeof w['openAxe.version'] !== 'function') return null
  return new NativeBridge()
}
