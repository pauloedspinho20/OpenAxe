/**
 * Neural Brain - TSL port of sabosugi's "Neural Brain" pen (see
 * ./definition.ts for credit).
 *
 *   generator (CPU, worker): fibres, sulcus lines, core, dots, dust, impulse paths
 *   -> fibres + impulses: one instanced screen-space ribbon quad per segment
 *   -> dots + dust: one instanced quad per point
 *   -> all additive, no depth -> bloom -> sRGB
 *
 * Porting notes:
 * - The pen's `ShaderMaterial`s are GLSL, which the WebGPU renderer can't run.
 *   The same maths is here as TSL node materials: `vertexNode` builds the clip
 *   position and the colour is computed per vertex and passed on as a varying.
 * - WebGPU draws points one pixel wide, so the `gl_PointSize` dots became
 *   instanced quads with the same size rule and the same round falloff.
 * - The pen shares one point buffer between neighbouring segments (an
 *   interleaved start/end view); here start and end are two copied instanced
 *   attributes, which every backend accepts.
 * - UnrealBloomPass with custom mip weights became TSL's `bloom` node.
 * - Mouse drag turns the brain (yaw, with inertia), as in the pen.
 */
import * as THREE from 'three/webgpu'
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  clamp,
  dot,
  exp,
  float,
  fract,
  int,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  modelNormalMatrix,
  normalize,
  pass,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  sRGBTransferOETF,
  step,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
  Fn,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'

import type {
  ParamValues,
  SceneContext,
  SceneFrame,
  SceneInstance,
  ScenePointerEvent,
} from '../../types'
import { EdgeTrigger, pickClusters } from './burst'
import type { BrainData, BrainOptions } from './generator'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const DEG = Math.PI / 180
const DRAG_TURN_PER_WIDTH = Math.PI * 1.2
const MAX_SPIN_SPEED = 6
const AUTO_RESUME_DELAY = 1.2
const REVEAL_SECONDS = 0.8
/** Impulse cluster slots (the generator makes at most 48 + 5). */
const MAX_CLUSTERS = 64

export function brainOptions(p: Readonly<ParamValues>, seedOverride?: number): BrainOptions {
  return {
    seed: seedOverride ?? Math.round(num(p.seed, 7)),
    density: num(p.fiberDensity, 1),
    fiberCount: num(p.fiberCount, 8000),
    fiberLength: num(p.fiberLength, 40),
    gyriDepth: num(p.gyriDepth, 0.11),
    gyriScale: num(p.gyriScale, 5.4),
    foldFollow: num(p.foldFollow, 2.4),
    sulcusLines: num(p.sulcusLines, 2600),
    shell: num(p.shell, 0.09),
    waviness: num(p.waviness, 0.25),
    dotRate: 0.014,
    warmDots: 0.3,
    dust: 22000,
    clusters: Math.round(num(p.pulseClusters, 26)),
    deepClusters: 5,
    pathsPerCluster: 7,
  }
}

/** Runs the generator in a worker, or on this thread if workers are unavailable. */
class Generator {
  private worker: Worker | null = null
  private job = 0
  private readonly pending = new Map<number, (d: BrainData) => void>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./brain.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<{ jobId: number; data: BrainData }>) => {
        const resolve = this.pending.get(e.data.jobId)
        this.pending.delete(e.data.jobId)
        resolve?.(e.data.data)
      }
    } catch {
      this.worker = null
    }
  }

  async run(options: BrainOptions): Promise<BrainData> {
    if (!this.worker) {
      const { generateBrain } = await import('./generator')
      return generateBrain(options) as BrainData
    }
    const id = ++this.job
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve)
      this.worker!.onerror = (e) => {
        this.pending.delete(id)
        reject(new Error(`Neural Brain generator failed: ${e.message}`))
      }
      this.worker!.postMessage({ jobId: id, options })
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}

function uniforms() {
  const c = () => uniform(new THREE.Color())
  return {
    time: uniform(0),
    resolution: uniform(new THREE.Vector2(1, 1)),
    pixelScale: uniform(1),
    exposure: uniform(1),
    reveal: uniform(0),
    depthFade: uniform(0.75),
    // fibres
    fiberWidth: uniform(0.0033),
    fiberOpacity: uniform(0.06),
    vesselBoost: uniform(1.8),
    topLight: uniform(0.9),
    sulci: uniform(0.7),
    rim: uniform(0.85),
    relief: uniform(0.8),
    lightDir: uniform(new THREE.Vector3(-0.45, 0.75, 0.5).normalize()),
    fiberDeep: c(),
    fiberCyan: c(),
    highlight: c(),
    far: c(),
    // impulses
    pulseWidth: uniform(0.009),
    pulseIntensity: uniform(3.2),
    fireTimes: uniformArray(new Array<number>(MAX_CLUSTERS).fill(-1e4), 'float'),
    fireAmps: uniformArray(new Array<number>(MAX_CLUSTERS).fill(0), 'float'),
    pulseSpeed: uniform(5),
    trail: uniform(0.75),
    flicker: uniform(0.5),
    pulse: c(),
    pulseTail: c(),
    pulseHot: c(),
    // dots
    dotSize: uniform(0.005),
    dotOpacity: uniform(0.9),
    dustOpacity: uniform(0.35),
    dotPulse: uniform(0.75),
    dotPulseSpeed: uniform(0.6),
    dot: c(),
    warmDot: c(),
  }
}
type U = ReturnType<typeof uniforms>

/** Depth of the object's centre and how far "behind" it a view depth is (pen's farK). */
function farFactor(u: U, depth: N): N {
  const centerDepth = modelViewMatrix.mul(vec4(0, 0, 0, 1)).z.negate()
  const dn = clamp(depth.sub(centerDepth).div(0.9), -1, 1)
  return smoothstep(-0.35, 1, dn).mul(u.depthFade)
}

/**
 * The pen's `ribbon()`: expand segment a->b into a screen-space quad of
 * `widthWorld` (perspective-correct, at least 1 px). Returns the clip position,
 * the sub-pixel alpha scale, the view depth and the side/half-width varyings.
 */
function ribbon(u: U, a: N, b: N, widthWorld: N) {
  const va = modelViewMatrix.mul(vec4(a, 1))
  const vb = modelViewMatrix.mul(vec4(b, 1))
  const ca = cameraProjectionMatrix.mul(va)
  const cb = cameraProjectionMatrix.mul(vb)
  const sa = ca.xy.div(ca.w).mul(u.resolution).mul(0.5)
  const sb = cb.xy.div(cb.w).mul(u.resolution).mul(0.5)
  const d = sb.sub(sa)
  const len = length(d)
  const dir = select(len.greaterThan(1e-4), d.div(max(len, 1e-4)), vec2(1, 0))
  const nrm = vec2(dir.y.negate(), dir.x)
  const isEnd = positionGeometry.x
  const c = mix(ca, cb, isEnd)
  const depth = mix(va.z, vb.z, isEnd).negate()
  const wpxRaw = widthWorld.mul(u.pixelScale).div(max(depth, 0.01))
  const alphaScale = min(wpxRaw, 1)
  const halfW = max(wpxRaw, 1).mul(0.5)
  const pad = halfW.add(0.75)
  const offPx = nrm.mul(positionGeometry.y).mul(pad)
  const clip = vec4(c.xy.add(offPx.div(u.resolution.mul(0.5)).mul(c.w)), c.z, c.w)
  return { clip, alphaScale, depth, side: positionGeometry.y.mul(pad), halfW }
}

/** Off-screen clip position: the pen's "gl_Position = vec4(2, 2, 2, 1)" cull. */
const CULLED = vec4(2, 2, 2, 1)

function additive(mat: THREE.NodeMaterial) {
  mat.transparent = true
  mat.depthWrite = false
  mat.depthTest = false
  mat.blending = THREE.AdditiveBlending
  mat.side = THREE.DoubleSide
  return mat
}

function fiberMaterial(u: U) {
  const aStart = attribute('aStart', 'vec3')
  const aEnd = attribute('aEnd', 'vec3')
  const aData = attribute('aData', 'vec4') // t, rand, gain, crown
  const aNormal = attribute('aNormal', 'vec3')
  const aRelief = attribute('aRelief', 'vec3')

  const vessel = aData.y.lessThan(0.08)
  const width = u.fiberWidth.mul(
    select(vessel, float(1.9), fract(aData.y.mul(13.7)).mul(0.9).add(0.45)),
  )
  const r = ribbon(u, aStart, aEnd, width)
  const farK = farFactor(u, r.depth)

  const t = aData.x
  const taper = smoothstep(0, 0.14, t).mul(smoothstep(1, 0.86, t))
  const shade = mix(float(1).sub(u.sulci), 1, aData.w)
  // Grazing surfaces pile up fibres in projection: flatten the silhouette rim.
  const nV = normalize(modelNormalMatrix.mul(aNormal))
  const vV = normalize(modelViewMatrix.mul(vec4(aStart, 1)).xyz.negate())
  const facing = abs(dot(nV, vV))
  const rimK = mix(1, smoothstep(0, 0.75, facing).mul(0.88).add(0.12), u.rim)

  const nW = normalize(modelWorldMatrix.mul(vec4(aNormal, 0)).xyz)
  const top = smoothstep(0.45, 1, nW.y).mul(u.topLight).mul(float(1).sub(farK))
  const base = mix(u.fiberDeep, u.fiberCyan, fract(aData.y.mul(7.31)))
  const lifted = mix(mix(base, u.highlight, top.mul(0.75)), u.far, farK)
  const c = select(vessel, mix(lifted, u.highlight, 0.25), lifted)
  // Relief: a fixed world-space key light over the folded normals.
  const rW = normalize(modelWorldMatrix.mul(vec4(aRelief, 0)).xyz)
  const lit = clamp(dot(rW, u.lightDir).mul(0.5).add(0.5), 0, 1)
  const bright = mix(1, 0.42, farK)
    .mul(top.mul(0.6).add(1))
    .mul(select(vessel, u.vesselBoost, float(1)))
    .mul(mix(1, lit.mul(lit).mul(1.35).add(0.25), u.relief))
  const stemFade = smoothstep(-1.42, -0.95, aStart.y)
  const color = c
    .mul(bright)
    .mul(shade)
    .mul(rimK)
    .mul(taper)
    .mul(aData.z)
    .mul(r.alphaScale)
    .mul(stemFade)
    .mul(u.fiberOpacity)
    .mul(u.reveal)

  const mat = additive(new THREE.MeshBasicNodeMaterial())
  // The last point of each fibre starts no segment.
  mat.vertexNode = select(t.greaterThan(0.99999), CULLED, r.clip)
  const vColor = varying(color)
  const vSide = varying(r.side)
  const vHalf = varying(r.halfW)
  mat.colorNode = vec4(vColor.mul(clamp(vHalf.add(0.5).sub(abs(vSide)), 0, 1)).mul(u.exposure), 1)
  return mat
}

/** The pen's hash11. */
function hash11(x: N): N {
  const a = fract(x.mul(0.1031))
  const b = a.mul(a.add(33.33))
  return fract(b.mul(b.add(b)))
}

function pulseMaterial(u: U) {
  const aStart = attribute('aStart', 'vec3')
  const aEnd = attribute('aEnd', 'vec3')
  const aPA = attribute('aPA', 'vec4') // s, path length, delay, cluster id
  const aPB = attribute('aPB', 'vec4') // hot, rand, break, -

  // Event driven (the pen fires clusters on a clock): a cluster fires only when
  // the scene stamps its slot with the time of a sound, at that sound's strength.
  const slot = int(aPA.w)
  const fireAt = u.fireTimes.element(slot)
  const tau = u.time.sub(fireAt)
  const fire = u.fireAmps.element(slot)
  // A fresh random subset of the cluster's paths lights on each firing.
  const pathOn = step(hash11(aPB.y.mul(91.7).add(fract(fireAt.mul(0.618)).mul(331))), 0.72)
  const head = tau.sub(aPA.z).mul(u.pulseSpeed)
  const behind = head.sub(aPA.x)
  const I0 = select(behind.greaterThanEqual(0), exp(behind.div(u.trail).negate()), float(0))
    .mul(fire)
    .mul(pathOn)
  const flick = float(1)
    .sub(u.flicker.mul(0.5))
    .add(u.flicker.mul(0.5).mul(sin(u.time.mul(61).add(aPB.y.mul(47)).add(aPA.x.mul(23)))))
  const flare = exp(behind.mul(behind).div(0.0012).negate()).mul(0.35)

  const r = ribbon(u, aStart, aEnd, u.pulseWidth.mul(I0.mul(0.6).add(0.55)))
  const farK = farFactor(u, r.depth)
  const I = pow(max(I0.sub(0.06), 0).div(0.94), 1.3)
  const c0 = mix(u.pulseTail, u.pulse, smoothstep(0.03, 0.4, I))
  const c1 = mix(c0, u.pulseHot, clamp(aPB.x.mul(0.9).add(flare.mul(0.35)), 0, 1)).add(
    vec3(flare.mul(0.5)),
  )
  const color = c1
    .mul(I)
    .mul(flick)
    .mul(u.pulseIntensity)
    .mul(mix(1, 0.55, farK))
    .mul(r.alphaScale)
    .mul(u.reveal)

  const mat = additive(new THREE.MeshBasicNodeMaterial())
  const culled = aPB.z.greaterThan(0.5).or(I0.lessThan(0.003))
  mat.vertexNode = select(culled, CULLED, r.clip)
  const vColor = varying(color)
  const vSide = varying(r.side)
  const vHalf = varying(r.halfW)
  mat.colorNode = vec4(vColor.mul(clamp(vHalf.add(0.5).sub(abs(vSide)), 0, 1)).mul(u.exposure), 1)
  return mat
}

function dotMaterial(u: U) {
  const aPos = attribute('aPos', 'vec3')
  const aData = attribute('aData', 'vec4') // size, rand, warm, layer
  const aNormal = attribute('aNormal', 'vec3')
  const corner = positionGeometry.xy // -0.5..0.5

  const mv = modelViewMatrix.mul(vec4(aPos, 1))
  const clip0 = cameraProjectionMatrix.mul(mv)
  const depth = mv.z.negate()
  const farK = farFactor(u, depth)
  const stemFade = smoothstep(-1.42, -0.95, aPos.y)
  const isDust = aData.w.greaterThan(1.5)

  // Inner dust: faint, steady, tinted with the far-side colour.
  const dpx = u.dotSize.mul(aData.x).mul(u.pixelScale).div(depth)
  const dk = min(dpx.div(1.6), 1)
  const dustSize = max(dpx, 1.6).add(1)
  const dustColor = mix(u.far, u.dot, 0.15)
    .mul(0.3)
    .mul(dk)
    .mul(mix(1, 0.6, farK))
    .mul(u.dustOpacity)

  // Surface dots breathe with their own speed and phase, then briefly swell and flare.
  const rnd = aData.y
  const speed = u.dotPulseSpeed.mul(fract(rnd.mul(17.31)).mul(0.9).add(0.55))
  const wave = sin(
    u.time
      .mul(speed)
      .mul(Math.PI * 2)
      .add(rnd.mul(43.98)),
  )
    .mul(0.5)
    .add(0.5)
  const beat = pow(wave, 5)
  const sizeMul = u.dotPulse.mul(1.5).mul(beat).add(1)
  const glowMul = float(1).sub(u.dotPulse.mul(0.5)).add(u.dotPulse.mul(2.4).mul(beat))
  const px = u.dotSize.mul(aData.x).mul(sizeMul).mul(u.pixelScale).div(depth)
  const sizeK = min(px.div(1.6), 1)
  const dotSizePx = max(px, 1.6).add(1)
  const facing = abs(dot(normalize(modelNormalMatrix.mul(aNormal)), normalize(mv.xyz.negate())))
  const a = sizeK.mul(glowMul).mul(mix(1, smoothstep(0, 0.75, facing).mul(0.85).add(0.15), u.rim))
  const dotColor = mix(u.dot, u.warmDot, aData.z)
    .mul(a)
    .mul(mix(1, 0.35, farK))
    .mul(u.dotOpacity)

  const sizePx = select(isDust, dustSize, dotSizePx)
  const color = select(isDust, dustColor, dotColor).mul(stemFade).mul(u.reveal)

  const mat = additive(new THREE.MeshBasicNodeMaterial())
  mat.vertexNode = vec4(
    clip0.xy.add(corner.mul(sizePx).div(u.resolution).mul(2).mul(clip0.w)),
    clip0.z,
    clip0.w,
  )
  const vColor = varying(color)
  mat.colorNode = Fn(() => {
    const rr = length(corner).mul(2)
    const core = smoothstep(1, 0.35, rr)
    const glow = exp(rr.mul(rr).mul(-3)).mul(0.35)
    return vec4(vColor.mul(core.add(glow)).mul(u.exposure), 1)
  })()
  return mat
}

const QUAD_RIBBON = new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0])
const QUAD_RIBBON_INDEX = [0, 2, 1, 2, 3, 1]
const QUAD_DOT = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0])
const QUAD_DOT_INDEX = [0, 1, 2, 2, 1, 3]

/** One instance per segment (point i -> i + 1), per-point data indexed by the start point. */
function stripGeometry(points: Float32Array, extra: Record<string, [Float32Array, number]>) {
  const segs = Math.max(0, points.length / 3 - 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.setIndex(QUAD_RIBBON_INDEX)
  geo.setAttribute('position', new THREE.Float32BufferAttribute(QUAD_RIBBON, 3))
  geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(points.slice(0, segs * 3), 3))
  geo.setAttribute('aEnd', new THREE.InstancedBufferAttribute(points.slice(3, 3 + segs * 3), 3))
  for (const [name, [array, size]] of Object.entries(extra)) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(array.slice(0, segs * size), size))
  }
  geo.instanceCount = segs
  return geo
}

function dotGeometry(d: BrainData) {
  const geo = new THREE.InstancedBufferGeometry()
  geo.setIndex(QUAD_DOT_INDEX)
  geo.setAttribute('position', new THREE.Float32BufferAttribute(QUAD_DOT, 3))
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(d.dotPos, 3))
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(d.dotData, 4))
  geo.setAttribute('aNormal', new THREE.InstancedBufferAttribute(d.dotNrm, 3))
  geo.instanceCount = d.dotPos.length / 3
  return geo
}

const COLOR_KEYS = [
  ['fiberDeep', '#1270d2'],
  ['fiberCyan', '#1fc0e2'],
  ['highlight', '#d2f4ff'],
  ['far', '#0f5a50'],
  ['dot', '#c8eeff'],
  ['warmDot', '#ff9a80'],
  ['pulse', '#ffc43d'],
  ['pulseTail', '#ff6a1a'],
  ['pulseHot', '#ff86e6'],
] as const

class NeuralBrain implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(20, 1, 0.05, 50)
  private readonly brain = new THREE.Group()
  private readonly u = uniforms()
  private readonly materials: THREE.NodeMaterial[]
  private readonly meshes: THREE.Mesh[] = []
  private readonly post: THREE.PostProcessing
  private readonly bloomNode: N
  private readonly scenePass: N
  private readonly generator = new Generator()
  private readonly background = new THREE.Color()
  private readonly hsl = { h: 0, s: 0, l: 0 }

  private width: number
  private height: number
  private sceneTime = 0
  private revealStart = -1
  private spin = 0
  private disposed = false
  private readonly drag = {
    active: false,
    id: -1,
    lastX: 0,
    pending: 0,
    velocity: 0,
    idle: 10,
    autoBlend: 1,
  }

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    this.width = ctx.width
    this.height = ctx.height
    this.scene.add(this.brain)
    this.scene.background = this.background
    this.materials = [fiberMaterial(this.u), dotMaterial(this.u), pulseMaterial(this.u)]

    // Post: bloom on the linear HDR frame, then sRGB (no tone mapping, as in the pen).
    this.post = new THREE.PostProcessing(this.renderer)
    this.post.outputColorTransform = false
    this.scenePass = pass(this.scene, this.camera)
    const hdr: N = this.scenePass.getTextureNode('output')
    this.bloomNode = bloom(hdr, 0.5, 0, 0.75)
    this.post.outputNode = vec4(sRGBTransferOETF(clamp(hdr.rgb.add(this.bloomNode.rgb), 0, 1)), 1)
  }

  async init(p: Readonly<ParamValues>) {
    const data = await this.generator.run(brainOptions(p))
    if (this.disposed) return
    this.setBrain(data)
    this.sync(p, 0, 0)
    await this.renderer.compileAsync(this.scene, this.camera)
  }

  private setBrain(d: BrainData) {
    for (const m of this.meshes) {
      this.brain.remove(m)
      m.geometry.dispose()
    }
    this.meshes.length = 0
    const [fiberMat, dotMat, pulseMat] = this.materials as [
      THREE.NodeMaterial,
      THREE.NodeMaterial,
      THREE.NodeMaterial,
    ]
    const fibers = new THREE.Mesh(
      stripGeometry(d.fiberPos, {
        aData: [d.fiberData, 4],
        aNormal: [d.fiberNrm, 3],
        aRelief: [d.fiberRel, 3],
      }),
      fiberMat,
    )
    const dots = new THREE.Mesh(dotGeometry(d), dotMat)
    const pulses = new THREE.Mesh(
      stripGeometry(d.pulsePos, { aPA: [d.pulseA, 4], aPB: [d.pulseB, 4] }),
      pulseMat,
    )
    fibers.renderOrder = 0
    dots.renderOrder = 1
    pulses.renderOrder = 2
    for (const m of [fibers, dots, pulses]) {
      m.frustumCulled = false
      this.brain.add(m)
      this.meshes.push(m)
    }
    if (this.revealStart < 0) this.revealStart = this.sceneTime
    this.clusterTotal = Math.min(d.clusterTotal, MAX_CLUSTERS)
    ;(this.u.fireAmps.array as number[]).fill(0)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  action(key: string) {
    if (key === 'resetView') {
      this.spin = 0
      this.drag.velocity = 0
      this.drag.pending = 0
    } else if (key === 'testFire') {
      this.fire(1, this.lastParams ?? {})
    } else if (key === 'randomize') {
      const seed = 1 + Math.floor(Math.random() * 998)
      // The params aren't ours to change, so the random brain lives until the next rebuild.
      void this.generator
        .run(brainOptions(this.lastParams ?? {}, seed))
        .then((d) => {
          if (!this.disposed) this.setBrain(d)
        })
        .catch(() => {})
    }
  }

  private lastParams: Readonly<ParamValues> | null = null
  private clusterTotal = 0
  private readonly trigger = new EdgeTrigger()

  /** Fire a share of the impulse clusters now, at `strength` (0..1). */
  private fire(strength: number, p: Readonly<ParamValues>) {
    const s = Math.min(Math.max(strength, 0), 1)
    const share = num(p.burstSize, 0.3)
    const count = Math.max(1, Math.round(this.clusterTotal * share * s))
    const times = this.u.fireTimes.array as number[]
    const amps = this.u.fireAmps.array as number[]
    for (const id of pickClusters(this.clusterTotal, count)) {
      times[id] = this.sceneTime
      amps[id] = 0.35 + 0.65 * s
    }
  }

  pointer(ev: ScenePointerEvent) {
    const d = this.drag
    if (ev.type === 'down') {
      if (d.active) return
      Object.assign(d, { active: true, id: ev.id, lastX: ev.x, velocity: 0 })
    } else if (d.active && ev.id === d.id) {
      if (ev.type === 'move') {
        const dx = ev.x - d.lastX
        d.lastX = ev.x
        const sens = num(this.lastParams?.dragSensitivity, 1)
        d.pending += (dx / Math.max(this.canvas.clientWidth, 1)) * DRAG_TURN_PER_WIDTH * sens
      } else {
        d.active = false
        d.id = -1
        d.idle = 0
      }
    }
  }

  /** dt: real seconds (drag works with time scale 0); sdt: scene seconds. */
  private updateRotation(p: Readonly<ParamValues>, dt: number, sdt: number) {
    const d = this.drag
    const follow = 1 - Math.exp(-dt * 20)
    const stepAmt = d.pending * follow
    d.pending -= stepAmt
    this.spin += stepAmt
    if (d.active) {
      const v = dt > 0 ? stepAmt / dt : 0
      d.velocity += (v - d.velocity) * (1 - Math.exp(-dt * 14))
      d.velocity = THREE.MathUtils.clamp(d.velocity, -MAX_SPIN_SPEED, MAX_SPIN_SPEED)
      d.idle = 0
    } else {
      this.spin += d.velocity * dt
      d.velocity *= Math.exp(-dt * (1.2 + (1 - num(p.inertia, 0.85)) * 10))
      d.idle += dt
    }
    const wantAuto = !d.active && d.idle > AUTO_RESUME_DELAY ? 1 : 0
    d.autoBlend += (wantAuto - d.autoBlend) * (1 - Math.exp(-dt * (wantAuto ? 0.9 : 6)))
    if (p.autoRotate !== false) {
      this.spin += num(p.rotationSpeed, 15) * DEG * sdt * d.autoBlend
    }
    this.brain.rotation.y = this.spin
  }

  private updateCamera(p: Readonly<ParamValues>) {
    const cam = this.camera
    const fov = num(p.fov, 20)
    cam.fov = fov
    cam.aspect = this.width / Math.max(this.height, 1)
    const t = Math.tan(fov * DEG * 0.5)
    const dist = Math.max(0.9 / t, 1.15 / (t * cam.aspect)) / Math.max(num(p.zoom, 1), 0.05)
    const e = num(p.elevation, 4) * DEG
    const oy = num(p.offsetY, 0)
    cam.position.set(0, oy + Math.sin(e) * dist, Math.cos(e) * dist)
    cam.lookAt(0, oy, 0)
    cam.updateProjectionMatrix()
    ;(this.u.resolution.value as THREE.Vector2).set(this.width, this.height)
    this.u.pixelScale.value = this.height / (2 * t)
  }

  private sync(p: Readonly<ParamValues>, dt: number, sdt: number) {
    this.lastParams = p
    const u = this.u
    this.sceneTime += sdt
    u.time.value = this.sceneTime
    if (this.revealStart >= 0) {
      u.reveal.value = Math.min(1, (this.sceneTime - this.revealStart) / REVEAL_SECONDS)
      // A time scale of 0 must not hold the brain invisible.
      if (sdt === 0 && dt > 0) this.revealStart -= dt
    }
    this.updateRotation(p, dt, sdt)
    this.updateCamera(p)

    u.exposure.value = num(p.exposure, 1)
    u.depthFade.value = num(p.depthFade, 0.75)
    u.fiberWidth.value = num(p.fiberWidth, 3.3) * 0.001
    u.fiberOpacity.value = num(p.fiberOpacity, 0.06)
    u.vesselBoost.value = num(p.vesselBoost, 1.8)
    u.topLight.value = num(p.topLight, 0.9)
    u.sulci.value = num(p.sulciShade, 0.7)
    u.rim.value = num(p.rimFlatten, 0.85)
    u.relief.value = num(p.relief, 0.8)
    u.pulseWidth.value = num(p.pulseWidth, 9) * 0.001
    u.pulseIntensity.value = num(p.pulseIntensity, 3.2)
    u.pulseSpeed.value = num(p.pulseSpeed, 5)
    u.trail.value = num(p.pulseTrail, 0.75)
    u.flicker.value = num(p.pulseFlicker, 0.5)
    u.dotSize.value = num(p.dotSize, 5) * 0.001
    u.dotOpacity.value = num(p.dotOpacity, 0.9)
    u.dustOpacity.value = num(p.dustOpacity, 0.35)
    u.dotPulse.value = num(p.dotPulse, 0)
    u.dotPulseSpeed.value = num(p.dotPulseSpeed, 0.6)

    const hue = num(p.hueShift, 0)
    for (const [key, fallback] of COLOR_KEYS) {
      const c = u[key].value as THREE.Color
      c.set(String(p[key] ?? fallback))
      if (hue !== 0) {
        c.getHSL(this.hsl)
        c.setHSL((this.hsl.h + hue) % 1, this.hsl.s, this.hsl.l)
      }
    }
    this.background.set(String(p.background ?? '#000000'))

    this.bloomNode.strength.value = num(p.bloom, 0.5)
    this.bloomNode.radius.value = num(p.bloomRadius, 0)
    this.bloomNode.threshold.value = num(p.bloomThreshold, 0.75)
  }

  update(frame: SceneFrame) {
    const p = frame.params
    this.sync(p, frame.dt, frame.dt * num(p.timeScale, 1))
    // Impulses only fire on sound: each rise of the (attack-driven) fire param.
    const strength = this.trigger.step(num(p.fire, 0))
    if (strength > 0) this.fire(strength, p)
    this.post.render()
  }

  dispose() {
    this.disposed = true
    this.generator.dispose()
    for (const m of this.meshes) m.geometry.dispose()
    for (const m of this.materials) m.dispose()
    this.scenePass.dispose()
    this.bloomNode.dispose()
    this.post.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new NeuralBrain(ctx)
  try {
    await scene.init(ctx.params)
  } catch (err) {
    scene.dispose()
    throw err
  }
  return scene
}
