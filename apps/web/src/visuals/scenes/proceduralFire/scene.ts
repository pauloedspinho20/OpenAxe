/**
 * Procedural Fire — OpenAxe VISUALS scene wrapping the native WebGPU
 * 3D combustion simulation, volumetric blackbody renderer, SDF campfire,
 * and GPU sparks ported from Leon Lin's `procedural-fire` (MIT License,
 * Copyright (c) 2026 Leon Lin, https://github.com/Leonxlnx/procedural-fire).
 */
import * as THREE from 'three/webgpu'

import type {
  ParamValues,
  SceneContext,
  SceneFrame,
  SceneInstance,
  ScenePointerEvent,
} from '../../types'
import { QUALITY_PRESETS, type QualityPreset, type QualityTier } from './definition'
import { EdgeTrigger, type Vec3, buildCampfire, halton, orbit, packLogs, packStones } from './math'
import { FireRenderer } from './renderer'
import { makeCurlTexture, makeNoiseTexture } from './shaders'
import { FireSim } from './sim'
import { Sparks } from './sparks'

interface WebGPURendererBackend {
  readonly isWebGPUBackend?: boolean
  readonly device?: GPUDevice
  getContext?: () => GPUCanvasContext
  readonly utils?: {
    getPreferredCanvasFormat?: () => GPUTextureFormat
  }
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const TONEMAP_INDEX: Readonly<Record<string, number>> = {
  agx: 0,
  filmic: 1,
  camera: 2,
}

class ProceduralFireScene implements SceneInstance {
  private readonly device: GPUDevice
  private readonly backend: Required<Pick<WebGPURendererBackend, 'getContext'>> &
    WebGPURendererBackend
  private readonly canvas: HTMLCanvasElement
  private readonly preset: QualityPreset

  private readonly noiseTex: GPUTexture
  private readonly curlTex: GPUTexture
  private readonly sim: FireSim
  private readonly fireRenderer: FireRenderer
  private readonly sparks: Sparks

  private readonly burstTrigger = new EdgeTrigger(0.05)

  private yawOffset = 0.35
  private orbitYaw = 0
  private pitchOffset = 0
  private zoomFactor = 1
  private vyaw = 0
  private vpitch = 0
  private dragging = false
  private pointerId = -1
  private lastX = 0
  private lastY = 0
  private idleTime = 0

  private simAcc = 0
  private frameNo = 0
  private fireIntensity = 0.85
  private stokeBoost = 0
  private windGustTime = 0
  private burstTime = 0
  private burstStrength = 0
  private burstPos: Vec3 = [0, 0.1, 0]
  private popClock = 2.5
  private curWhiteBalance = 5000

  private readonly onWheel: (e: WheelEvent) => void
  private readonly onDblClick: () => void

  constructor(
    ctx: SceneContext,
    device: GPUDevice,
    backend: Required<Pick<WebGPURendererBackend, 'getContext'>> & WebGPURendererBackend,
  ) {
    this.device = device
    this.backend = backend
    this.canvas = ctx.canvas

    const tierRaw = String(ctx.params.quality ?? 'med')
    const tier: QualityTier =
      tierRaw === 'fast' ||
      tierRaw === 'low' ||
      tierRaw === 'med' ||
      tierRaw === 'high' ||
      tierRaw === 'ultra'
        ? tierRaw
        : 'med'
    this.preset = QUALITY_PRESETS[tier]
    const seed = Math.max(1, Math.round(num(ctx.params.seed, 7)))
    this.fireIntensity = num(ctx.params.intensity, 0.85)

    this.noiseTex = makeNoiseTexture(device, 128, 1)
    this.curlTex = makeCurlTexture(device, this.noiseTex, 128)

    const campfire = buildCampfire(seed)
    const logsF32 = packLogs(campfire.logs)
    const stonesF32 = packStones(campfire.stones)

    this.sim = new FireSim(device, {
      res: this.preset.res,
      size: [1.2, 1.8, 1.2],
      logs: logsF32,
      vcycles: this.preset.vcycles,
      mgSmooth: this.preset.mgSmooth,
      coarseCap: this.preset.coarseCap,
      maccormack: this.preset.maccormack,
      noiseTex: this.noiseTex,
      curlTex: this.curlTex,
      seed,
    })

    const format =
      backend.utils?.getPreferredCanvasFormat?.() ?? navigator.gpu.getPreferredCanvasFormat()
    this.fireRenderer = new FireRenderer(device, {
      sim: this.sim,
      nLogs: campfire.logs.length,
      nStones: campfire.stones.length,
      noiseTex: this.noiseTex,
      curlTex: this.curlTex,
      logsF32,
      stonesF32,
      format,
    })
    this.fireRenderer.params.stepMul = this.preset.stepMul
    this.fireRenderer.params.shadowMode = this.preset.shadowMode
    this.fireRenderer.params.shadowSteps = this.preset.shadowSteps
    this.fireRenderer.surfScale = this.preset.surfScale
    this.fireRenderer.resize(ctx.width, ctx.height, this.preset.volScale, this.preset.surfScale)

    this.sparks = new Sparks(device, {
      count: this.preset.sparks,
      sim: this.sim,
      renderer: this.fireRenderer,
      curlTex: this.curlTex,
    })

    this.onWheel = (e: WheelEvent) => {
      e.preventDefault()
      this.zoomFactor = THREE.MathUtils.clamp(
        this.zoomFactor * Math.exp(e.deltaY * 0.001),
        0.35,
        2.5,
      )
      this.idleTime = 0
      this.fireRenderer.histReset = true
    }
    this.onDblClick = () => {
      this.action('resetView')
    }
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('dblclick', this.onDblClick)
  }

  async init(params: Readonly<ParamValues>): Promise<void> {
    this.syncParams(params, 0)
    // Pre-warm the simulation so flames are already rising on the first frame,
    // and execute every render compute pass inside the host's error scope.
    for (let i = 0; i < 24; i++) {
      const enc = this.device.createCommandEncoder()
      this.sim.step(enc, 1 / 60)
      this.sparks.step(enc, 1 / 60)
      this.device.queue.submit([enc.finish()])
    }
    this.fireRenderer.uploadParams(this.sim.time, this.frameNo++, [0, 0])
    const enc = this.device.createCommandEncoder()
    this.fireRenderer.renderHDR(enc)
    this.sparks.draw(enc, this.preset.simDt * 0.65)
    this.fireRenderer.temporal(enc, 1)
    this.fireRenderer.bloom(enc, true)
    this.device.queue.submit([enc.finish()])
    this.fireRenderer.histReset = true
    await this.device.queue.onSubmittedWorkDone()
  }

  resize(width: number, height: number): void {
    if (width < 1 || height < 1) return
    this.fireRenderer.resize(width, height, this.preset.volScale, this.preset.surfScale)
  }

  action(key: string): void {
    if (key === 'stoke') {
      this.triggerEvent('log-shift', 1)
    } else if (key === 'pop') {
      this.triggerEvent('pop', 0.9)
    } else if (key === 'gustAction') {
      this.windGustTime = 2.4
    } else if (key === 'resetView') {
      this.yawOffset = 0.35
      this.orbitYaw = 0
      this.pitchOffset = 0
      this.zoomFactor = 1
      this.vyaw = 0
      this.vpitch = 0
      this.fireRenderer.histReset = true
    } else if (key === 'resetFire') {
      this.sim.reset()
      this.sparks.reset()
      this.fireRenderer.resetLights()
      this.fireRenderer.histReset = true
      this.stokeBoost = 0
      this.burstTime = 0
    }
  }

  pointer(ev: ScenePointerEvent): void {
    if (ev.type === 'down') {
      if (this.dragging) return
      this.dragging = true
      this.pointerId = ev.id
      this.lastX = ev.x
      this.lastY = ev.y
      this.vyaw = 0
      this.vpitch = 0
      this.idleTime = 0
      return
    }
    if (!this.dragging || ev.id !== this.pointerId) return
    if (ev.type === 'move') {
      this.vyaw = -(ev.x - this.lastX) * 0.005
      this.vpitch = (ev.y - this.lastY) * 0.004
      this.yawOffset += this.vyaw
      this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + this.vpitch, -0.45, 1.0)
      this.lastX = ev.x
      this.lastY = ev.y
      this.idleTime = 0
      this.fireRenderer.histReset = true
    } else {
      this.dragging = false
      this.pointerId = -1
    }
  }

  private triggerEvent(type: 'pop' | 'log-shift', strength: number): void {
    const pos: Vec3 = [
      (Math.random() - 0.5) * 0.22,
      0.09 + Math.random() * 0.08,
      (Math.random() - 0.5) * 0.22,
    ]
    if (type === 'log-shift') {
      this.sparks.burst({
        n: Math.round(180 * strength),
        pos,
        speed: 4.2,
        radius: 0.12,
        dur: 0.15,
        fan: 0.7,
        size: 1.5,
      })
      this.burstPos = [pos[0], 0.08, pos[2]]
      this.burstTime = 0.25
      this.burstStrength = 1
      this.stokeBoost = Math.max(this.stokeBoost, 0.45)
    } else {
      this.sparks.burst({
        n: Math.round(25 + 85 * strength),
        pos,
        speed: 3.0 + 2.8 * strength,
        radius: 0.03,
        dur: 0.06,
        fan: 0.85,
        size: 1.35,
      })
      this.burstPos = [pos[0], 0.08, pos[2]]
      this.burstTime = 0.12
      this.burstStrength = 0.4 + 0.6 * strength
    }
  }

  private syncParams(p: Readonly<ParamValues>, realDt: number): void {
    const wb = Math.round(num(Number(p.whiteBalance), 5000))
    if (wb !== this.curWhiteBalance && wb >= 2000 && wb <= 12000) {
      this.curWhiteBalance = wb
      this.fireRenderer.setWhiteBalance(wb)
    }

    this.stokeBoost *= Math.exp(-realDt / 0.8)
    this.windGustTime = Math.max(0, this.windGustTime - realDt)
    this.burstTime = Math.max(0, this.burstTime - realDt)
    const gw = this.windGustTime > 0 ? Math.sin(Math.PI * (1 - this.windGustTime / 2.4)) : 0

    const intensityTarget = Math.max(0.05, num(p.intensity, 0.85) + this.stokeBoost)
    if (realDt > 0) {
      const rate = this.fireIntensity < intensityTarget ? 4.0 : 1.8
      this.fireIntensity += (intensityTarget - this.fireIntensity) * (1 - Math.exp(-rate * realDt))
    } else {
      this.fireIntensity = intensityTarget
    }

    const cinematic = p.flameStyle === 'cinematic'
    const turbUser = Math.max(0, num(p.turbulence, 0.8))
    const vortUser = Math.max(0, num(p.vorticity, 8))
    const smoke = Math.max(0, num(p.smoke, 0.02))

    this.sim.setParams({
      ...(cinematic
        ? {
            visc: 2,
            lamAge: 0.2,
            anchorFreq: 1,
            srcFloor: -0.3,
            anchorGain: 2.7,
            fuelSrc: 0.15,
            vortEps: vortUser * 0.5,
            turbAmp: turbUser * 0.5,
            turbFreq: 0.7,
            turbEvolve: 0.28,
          }
        : {
            visc: 0,
            lamAge: 0,
            anchorFreq: 1.6,
            srcFloor: 0.25,
            anchorGain: 0.95,
            fuelSrc: 0.13,
            vortEps: vortUser,
            turbAmp: turbUser,
            turbFreq: 1.5,
            turbEvolve: 0.6,
          }),
      intensity: this.fireIntensity,
      buoyancy: num(p.buoyancy, 26.8),
      windX: num(p.windX, 0) - 1.4 * gw,
      windZ: num(p.windZ, 0) + 0.5 * gw,
      gust: num(p.gust, 0) + 0.5 * gw,
      smolder: smoke,
      burstX: this.burstPos[0],
      burstY: this.burstPos[1],
      burstZ: this.burstPos[2],
      burstAmt: this.burstTime > 0 ? this.burstStrength : 0,
    })

    const cubic = p.cubicFilter === true ? 1 : 0
    const rp = this.fireRenderer.params
    rp.cubic = cubic
    rp.flameSharp = cubic
    rp.detailAmt = cinematic ? 0.3 : 0.6
    rp.sootEdge = cinematic ? 0.12 : 0
    rp.lightK = cinematic ? 0.6 : 1.0
    rp.surfDetail = num(p.surfDetail, 0.6)
    rp.smokeScat = smoke
    rp.bedGlow = num(p.emberGlow, 1)
    rp.logGlow = num(p.emberGlow, 1)
    rp.blueK = num(p.blueFlame, 0.05)
    rp.hueShift = num(p.hueShift, 0)
    rp.exposure = num(p.exposure, 15)
    rp.bloomK = num(p.bloom, 0.04)
    rp.hazeK = num(p.heatHaze, 1)
    rp.moon = num(p.moonlight, 1)
    rp.tonemap = TONEMAP_INDEX[String(p.tonemap ?? 'camera')] ?? 2
    rp.saturation = num(p.saturation, 1)
    rp.contrast = num(p.contrast, 1)
    rp.vignette = num(p.vignette, 0.6)
    rp.grain = num(p.grain, 0.02)

    this.sparks.rate = Math.max(0, num(p.sparkRate, 2)) * (0.3 + 0.7 * this.fireIntensity)
    this.sparks.params.brightness = num(p.sparkBrightness, 13)
    this.sparks.params.turb = num(p.sparkTurbulence, 1)

    // Camera orbit + inertia + modulated speed integration.
    const paused = p.paused === true
    const simDt = paused ? 0 : realDt * Math.max(0, num(p.timeScale, 1))
    if (!this.dragging && realDt > 0) {
      this.yawOffset += this.vyaw
      this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + this.vpitch, -0.45, 1.0)
      this.vyaw *= Math.exp(-realDt * 6)
      this.vpitch *= Math.exp(-realDt * 9)
      this.idleTime += realDt
      const autoBlend = Math.min(this.idleTime / 2, 1)
      this.orbitYaw += simDt * num(p.orbitSpeed, 0) * autoBlend
      if (Math.abs(this.vyaw) > 1e-4 || Math.abs(this.vpitch) > 1e-4) {
        this.fireRenderer.histReset = true
      }
    }

    const pitch = THREE.MathUtils.clamp(num(p.camPitch, 0.15) + this.pitchOffset, -0.02, 1.25)
    const dist = THREE.MathUtils.clamp(num(p.camDistance, 2.35) * this.zoomFactor, 0.7, 7)
    const ty = num(p.camHeight, 0.45)
    const fov = THREE.MathUtils.clamp(num(p.fov, 40), 15, 85)
    this.fireRenderer.setCamera(
      orbit({
        yaw: this.yawOffset + this.orbitYaw,
        pitch,
        dist,
        target: [0, ty, 0],
        fov,
      }),
    )
  }

  update(frame: SceneFrame): void {
    const w = this.canvas.width
    const h = this.canvas.height
    if (w < 1 || h < 1) return

    this.fireRenderer.resize(w, h, this.preset.volScale, this.preset.surfScale)

    const p = frame.params
    this.syncParams(p, frame.dt)

    const paused = p.paused === true
    const timeScale = Math.max(0, num(p.timeScale, 1))
    const simElapsed = paused ? 0 : frame.dt * timeScale

    // Audio-driven rising-edge spark/flare trigger + occasional ambient embers.
    const trig = this.burstTrigger.step(num(p.burst, 0))
    if (trig > 0 && !paused) {
      this.triggerEvent('pop', Math.min(1, 0.35 + trig * 0.75))
    }
    if (!paused && this.fireIntensity > 0.25) {
      this.popClock -= frame.dt
      if (this.popClock <= 0) {
        this.popClock = 2.0 + Math.random() * 4.0
        this.sparks.burst({
          n: Math.round(4 + Math.random() * 10),
          pos: [
            (Math.random() - 0.5) * 0.28,
            0.09 + Math.random() * 0.06,
            (Math.random() - 0.5) * 0.28,
          ],
          speed: 2.4 + Math.random() * 1.8,
          radius: 0.03,
          dur: 0.05,
          fan: 0.8,
          size: 1.2,
        })
      }
    }

    const swapTex = this.backend.getContext().getCurrentTexture()
    if (swapTex.width < 1 || swapTex.height < 1) return

    const enc = this.device.createCommandEncoder()

    if (simElapsed > 0) {
      this.simAcc += simElapsed
      if (this.simAcc >= this.preset.simDt) {
        this.sim.step(enc, this.preset.simDt)
        this.sparks.step(enc, this.preset.simDt)
        this.simAcc = Math.min(this.simAcc - this.preset.simDt, this.preset.simDt * 0.999)
      }
    }

    const useTaa = p.temporalAA !== false && !paused
    const j = (this.frameNo % 16) + 1
    const jitter: readonly [number, number] = useTaa
      ? [halton(j, 2) - 0.5, halton(j, 3) - 0.5]
      : [0, 0]

    this.fireRenderer.uploadParams(this.sim.time, this.frameNo++, jitter)
    this.fireRenderer.renderHDR(enc)
    this.sparks.draw(enc, this.preset.simDt * 0.65)
    if (useTaa) this.fireRenderer.temporal(enc, this.dragging ? 0.8 : 0.4)
    if (this.fireRenderer.params.bloomK > 1e-4) this.fireRenderer.bloom(enc, useTaa)
    this.fireRenderer.final(enc, swapTex.createView(), swapTex.format, useTaa)
    this.device.queue.submit([enc.finish()])
  }

  dispose(): void {
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDblClick)
    this.sparks.dispose()
    this.fireRenderer.dispose()
    this.sim.dispose()
    this.curlTex.destroy()
    this.noiseTex.destroy()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const backend = (ctx.renderer as unknown as { backend?: WebGPURendererBackend }).backend
  if (!backend?.isWebGPUBackend || !backend.device || !backend.getContext) {
    throw new Error('Procedural Fire requires WebGPU (unavailable on the WebGL2 fallback).')
  }
  const scene = new ProceduralFireScene(
    ctx,
    backend.device,
    backend as Required<Pick<WebGPURendererBackend, 'getContext'>> & WebGPURendererBackend,
  )
  try {
    await scene.init(ctx.params)
  } catch (err) {
    scene.dispose()
    throw err
  }
  return scene
}
