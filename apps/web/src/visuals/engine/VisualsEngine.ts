/**
 * Hosts one scene at a time on a shared WebGPURenderer: owns the frame loop,
 * reads the audio taps, runs feature extraction and modulation, and hands
 * each scene its frame. React only pushes settings in (see VisualsView).
 *
 * Kept free of React and of three's scene graph so it can be unit-tested
 * with a fake renderer, and so scenes stay the only place that knows how
 * they render.
 */
import type { WebGPURenderer } from 'three/webgpu'

import {
  FeatureEngine,
  DEFAULT_FEATURE_SETTINGS,
  type FeatureSettings,
} from '../audio/FeatureEngine'
import type { AudioFeatures } from '../audio/features'
import { Modulator } from '../modulation'
import type {
  Modulation,
  ParamValue,
  ParamValues,
  SceneDefinition,
  SceneInstance,
  ScenePointerEvent,
} from '../types'

/** Structural slice of AnalyserNode / NativeAnalyser the engine reads. */
export interface AudioTap {
  readonly fftSize: number
  getFloatTimeDomainData(buffer: Float32Array<ArrayBuffer>): void
}

export interface EngineTaps {
  /** Loudness + timbre source. */
  spectral: AudioTap | null
  /** Pitch source. */
  pitch: AudioTap | null
  sampleRate: number
}

export type EngineStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; sceneId: string }
  | { kind: 'running'; sceneId: string }
  | { kind: 'error'; message: string }

export interface EngineListener {
  status?: (status: EngineStatus) => void
  fps?: (fps: number) => void
}

export interface FixedSize {
  width: number
  height: number
}

export class VisualsEngine {
  readonly features: Readonly<AudioFeatures>
  private readonly featureEngine = new FeatureEngine()
  private readonly modulator = new Modulator()
  private readonly modulated: ParamValues = {}

  private renderer: WebGPURenderer | null = null
  private scene: SceneInstance | null = null
  private def: SceneDefinition | null = null
  private base: ParamValues = {}
  private mods: readonly Modulation[] = []
  private analysis: FeatureSettings = { ...DEFAULT_FEATURE_SETTINGS }
  private taps: EngineTaps = { spectral: null, pitch: null, sampleRate: 48000 }
  private spectralBuf: Float32Array<ArrayBuffer> | null = null
  private pitchBuf: Float32Array<ArrayBuffer> | null = null

  private raf = 0
  private lastNow = 0
  private lastFrame = 0
  private sceneTime = 0
  private fpsFrames = 0
  private fpsTime = 0
  private fpsCap = 60
  private resolution = 0.75
  private cssWidth = 1
  private cssHeight = 1
  private fixedSize: FixedSize | null = null
  private generation = 0
  private disposed = false
  private status: EngineStatus = { kind: 'idle' }
  private backendName: 'WebGPU' | 'WebGL2' | null = null

  private readonly canvas: HTMLCanvasElement
  private readonly listener: EngineListener

  constructor(canvas: HTMLCanvasElement, listener: EngineListener = {}) {
    this.canvas = canvas
    this.listener = listener
    this.features = this.featureEngine.features
  }

  get backend() {
    return this.backendName
  }

  /** Creates the renderer. Throws when neither WebGPU nor WebGL2 is usable. */
  async init(): Promise<void> {
    const { WebGPURenderer } = await import('three/webgpu')
    if (this.disposed) return
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, alpha: false })
    await renderer.init()
    if (this.disposed) {
      renderer.dispose()
      return
    }
    renderer.setClearColor(0x000000, 1)
    this.renderer = renderer
    const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend
    this.backendName = backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2'
    this.applySize()
    if (!this.paused) this.start()
  }

  private setStatus(status: EngineStatus) {
    this.status = status
    this.listener.status?.(status)
  }

  getStatus() {
    return this.status
  }

  /** Loads (or rebuilds) a scene. Resolves when it is rendering or has failed. */
  async loadScene(def: SceneDefinition, params: ParamValues): Promise<void> {
    const gen = ++this.generation
    this.setStatus({ kind: 'loading', sceneId: def.id })
    this.base = { ...params }
    try {
      const mod = await def.load()
      const renderer = this.renderer
      if (gen !== this.generation || this.disposed || !renderer) return
      this.scene?.dispose()
      this.scene = null
      const size = renderer.getDrawingBufferSize(new (await import('three')).Vector2())
      // WebGPU reports shader/pipeline failures asynchronously and three only
      // logs them, which would leave a silently black canvas: catch them here.
      const device = (renderer as unknown as { backend?: { device?: GPUDevice } }).backend?.device
      device?.pushErrorScope('validation')
      const created = await Promise.resolve()
        .then(() =>
          mod.createScene({
            renderer,
            canvas: this.canvas,
            width: size.x,
            height: size.y,
            params: this.base,
          }),
        )
        .then(
          (scene) => ({ scene, error: null }),
          (error: unknown) => ({ scene: null, error }),
        )
      const gpuError = await device?.popErrorScope()
      if (gpuError) {
        created.scene?.dispose()
        throw new Error(`Shader failed to compile: ${gpuError.message.split('\n')[0]}`)
      }
      if (!created.scene) throw created.error
      const instance = created.scene
      if (gen !== this.generation || this.disposed) {
        instance.dispose()
        return
      }
      if (this.def?.id !== def.id) this.modulator.reset()
      this.def = def
      this.scene = instance
      this.sceneTime = 0
      this.setStatus({ kind: 'running', sceneId: def.id })
    } catch (error) {
      if (gen !== this.generation) return
      console.error('[visuals] scene failed to load', error)
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  setParams(params: ParamValues) {
    const prev = this.base
    this.base = { ...params }
    if (!this.scene?.setParam) return
    for (const key in params)
      if (params[key] !== prev[key]) this.scene.setParam(key, params[key] as ParamValue)
  }

  setModulations(mods: readonly Modulation[]) {
    this.mods = mods
  }

  setAnalysis(settings: FeatureSettings) {
    this.analysis = settings
  }

  setTaps(taps: EngineTaps) {
    this.taps = taps
  }

  setPerformance(resolution: number, fpsCap: number) {
    this.fpsCap = fpsCap
    if (resolution !== this.resolution) {
      this.resolution = resolution
      this.applySize()
    }
  }

  /** CSS size of the canvas box. */
  setViewport(width: number, height: number) {
    this.cssWidth = Math.max(1, width)
    this.cssHeight = Math.max(1, height)
    this.applySize()
  }

  /** Renders at an exact size (recording) instead of following the viewport; null to go back. */
  setFixedSize(size: FixedSize | null) {
    this.fixedSize = size
    this.applySize()
  }

  /** Stops the frame loop (view hidden) without tearing anything down. */
  setPaused(paused: boolean) {
    if (paused === this.paused || !this.renderer) {
      this.paused = paused
      return
    }
    this.paused = paused
    if (paused) cancelAnimationFrame(this.raf)
    else this.start()
  }

  private paused = false

  action(key: string) {
    this.scene?.action?.(key)
  }

  pointer(ev: ScenePointerEvent) {
    this.scene?.pointer?.(ev)
  }

  private applySize() {
    const r = this.renderer
    if (!r) return
    if (this.fixedSize) {
      r.setPixelRatio(1)
      r.setSize(this.fixedSize.width, this.fixedSize.height, false)
    } else {
      const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
      r.setPixelRatio(Math.min(dpr * this.resolution, 2))
      r.setSize(this.cssWidth, this.cssHeight, false)
    }
    const w = this.canvas.width
    const h = this.canvas.height
    this.scene?.resize(w, h)
  }

  private readTap(tap: AudioTap | null, buf: Float32Array<ArrayBuffer> | null) {
    if (!tap || tap.fftSize <= 0) return null
    const out = buf && buf.length === tap.fftSize ? buf : new Float32Array(tap.fftSize)
    tap.getFloatTimeDomainData(out)
    return out
  }

  private start() {
    const loop = (now: number) => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      this.frame(now)
    }
    this.lastNow = performance.now()
    this.lastFrame = this.lastNow
    this.raf = requestAnimationFrame(loop)
  }

  private frame(now: number) {
    if (this.fpsCap > 0) {
      const interval = 1000 / this.fpsCap
      if (now - this.lastFrame < interval * 0.95) return
      this.lastFrame = Math.max(this.lastFrame + interval, now - interval)
    }
    const dt = Math.min(Math.max((now - this.lastNow) / 1000, 1e-4), 0.1)
    this.lastNow = now

    const sameTap = this.taps.spectral && this.taps.spectral === this.taps.pitch
    this.spectralBuf = this.readTap(this.taps.spectral, this.spectralBuf)
    this.pitchBuf = sameTap ? this.spectralBuf : this.readTap(this.taps.pitch, this.pitchBuf)
    this.featureEngine.update(
      { spectral: this.spectralBuf, pitch: this.pitchBuf, sampleRate: this.taps.sampleRate, dt },
      this.analysis,
    )

    const scene = this.scene
    const def = this.def
    if (!scene || !def) return
    this.sceneTime += dt
    this.modulator.apply(def.params, this.base, this.mods, this.features, dt, this.modulated)
    try {
      scene.update({ dt, time: this.sceneTime, params: this.modulated, audio: this.features })
    } catch (error) {
      console.error('[visuals] scene update failed', error)
      this.scene = null
      scene.dispose()
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    this.fpsFrames++
    this.fpsTime += dt
    if (this.fpsTime >= 0.5) {
      this.listener.fps?.(Math.round(this.fpsFrames / this.fpsTime))
      this.fpsFrames = 0
      this.fpsTime = 0
    }
  }

  dispose() {
    this.disposed = true
    this.generation++
    cancelAnimationFrame(this.raf)
    this.scene?.dispose()
    this.scene = null
    this.renderer?.dispose()
    this.renderer = null
  }
}
