/**
 * Reaction Diffusion - TSL port of Shader Effects Inc.'s Gray-Scott
 * component (see ./definition.ts for credit). Structure follows the original:
 *
 *   seed (scatter V into U = 1)  ->  N x Gray-Scott step (9-point Laplacian,
 *   clamp-to-edge = no-flux walls, brush/bloom injection)  ->  publish to a
 *   filterable texture  ->  cover-fit display: 3-colour ramp on V + relief light
 *
 * Porting notes:
 * - The original ping-pongs two vec2 storage buffers in compute kernels and
 *   copies the result into an rgba16float texture. Here the state ping-pongs
 *   between two float render targets drawn by full-screen passes, which run
 *   the same on WebGPU and the WebGL2 fallback (no storage textures needed).
 * - One material per direction (A->B, B->A) instead of swapping a texture
 *   node's value; both share the same uniforms.
 * - Iterations per frame become a rate (steps per 60 Hz frame) with the
 *   remainder carried over, so the growth speed doesn't depend on refresh rate
 *   and the speed can be modulated smoothly.
 * - The colour ramp mixes in display space (the original offers OKLCH etc.).
 * - The child-layer "drive" variant has no equivalent here and is dropped.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  hash,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import type {
  ParamValues,
  SceneContext,
  SceneFrame,
  SceneInstance,
  ScenePointerEvent,
} from '../../types'
import { operatingPoint } from './presets'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

/** Fraction of cells seeded with V at (re)initialisation. */
const SEED_DENSITY = 0.05
/** Bloom + brush splats applied in one step. */
const MAX_SPLATS = 8
/** Hard cap on steps per frame (the original's slider max is 16). */
const MAX_STEPS_PER_FRAME = 32

// Relief lighting (visual tuning, from the original)
const RELIEF_STRENGTH = 6.0
const RELIEF_AMBIENT = 0.42
const RELIEF_LIGHT_XY = 0.85
const RELIEF_LIGHT_Z = 0.55
const RELIEF_SHININESS = 18.0
const RELIEF_SPEC = 0.35

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Display-space colour from '#rrggbb' (no colour management, like the original). */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Rotate a colour around the grey axis by `turns` of the colour wheel. */
function hueRotate(c: N, turns: N): N {
  const k = vec3(0.57735027)
  const a = turns.mul(Math.PI * 2)
  const ca = cos(a)
  return c
    .mul(ca)
    .add(cross(k, c).mul(sin(a)))
    .add(k.mul(dot(k, c)).mul(float(1).sub(ca)))
}

function makeTarget(
  n: number,
  type: THREE.TextureDataType,
  filter: THREE.MagnificationTextureFilter,
) {
  return new THREE.RenderTarget(n, n, {
    type,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  })
}

function build(n: number) {
  const u = {
    feed: uniform(0.0545),
    kill: uniform(0.062),
    dv: uniform(0.5),
    seed: uniform(0),
    seedDensity: uniform(SEED_DENSITY),
    // xy = field uv, z = radius (field uv), w = strength; w = 0 disables
    splats: Array.from({ length: MAX_SPLATS }, () => uniform(new THREE.Vector4())),
    view: uniform(1 / 3),
    aspect: uniform(1),
    colorBackground: uniform(new THREE.Vector3()),
    colorWall: uniform(new THREE.Vector3()),
    colorCell: uniform(new THREE.Vector3()),
    hueShift: uniform(0),
    contrast: uniform(0.5),
    threshold: uniform(0.28),
    relief: uniform(0.4),
    lightAngle: uniform(135),
    brightness: uniform(1),
  }

  const state = [
    makeTarget(n, THREE.FloatType, THREE.NearestFilter),
    makeTarget(n, THREE.FloatType, THREE.NearestFilter),
  ] as const
  const display = makeTarget(n, THREE.HalfFloatType, THREE.LinearFilter)
  const texel = 1 / n

  // ---------- Seed / clear: U = 1, V scattered ----------
  const seedMat = new THREE.MeshBasicNodeMaterial()
  {
    // 3x3-cell clumps: single-cell seeds die out in the sparser regimes (mitosis, spots).
    const cell = floor(uv().mul(n / 3))
    const h = hash(cell.x.add(cell.y.mul(n)).add(u.seed))
    seedMat.colorNode = vec4(1, select(h.lessThan(u.seedDensity), float(1), float(0)), 0, 1)
  }

  // ---------- One Gray-Scott step, reading `src` ----------
  const stepMaterial = (src: THREE.Texture) => {
    const mat = new THREE.MeshBasicNodeMaterial()
    // Inside a Fn so the toVar/addAssign below have a stack to land on.
    mat.colorNode = Fn(() => {
      const p = uv()
      const at = (dx: number, dy: number) => texture(src, p.add(vec2(dx * texel, dy * texel))).xy
      const self = at(0, 0).toVar()
      const L = at(-1, 0)
      const R = at(1, 0)
      const T = at(0, -1)
      const B = at(0, 1)
      const TL = at(-1, -1)
      const TR = at(1, -1)
      const BL = at(-1, 1)
      const BR = at(1, 1)
      // 9-point weighted Laplacian (centre -1)
      const lap = L.add(R)
        .add(T)
        .add(B)
        .mul(0.2)
        .add(TL.add(TR).add(BL).add(BR).mul(0.05))
        .sub(self)
        .toVar()
      const U = self.x
      const V = self.y
      const uvv = U.mul(V).mul(V).toVar()
      // Du = 1, dt = 1 (as in the original)
      const newU = U.add(lap.x.sub(uvv).add(u.feed.mul(float(1).sub(U)))).toVar()
      const newV = V.add(u.dv.mul(lap.y).add(uvv).sub(u.feed.add(u.kill).mul(V))).toVar()
      // Soft Gaussian splats (brush + blooms) pull cells toward Pearson's seed state
      // (U = 0.5, V = 0.25), which grows in every regime. Adding V alone, as the original
      // brush does, lets U collapse under a big blob so it dies once the splat stops.
      // Disabled slots have w = 0.
      for (const s of u.splats) {
        const d = p.sub(s.xy)
        const r2 = max(s.z.mul(s.z), 1e-8)
        const w = clamp(exp(dot(d, d).div(r2).negate()).mul(s.w), 0, 1)
        newU.assign(mix(newU, 0.5, w))
        newV.assign(mix(newV, max(newV, 0.25), w))
      }
      return vec4(clamp(newU, 0, 1), clamp(newV, 0, 1), 0, 1)
    })()
    return mat
  }
  const stepMats = [stepMaterial(state[0].texture), stepMaterial(state[1].texture)] as const

  // ---------- Publish to the filterable display texture ----------
  const publishMaterial = (src: THREE.Texture) => {
    const mat = new THREE.MeshBasicNodeMaterial()
    mat.colorNode = vec4(texture(src, uv()).xy, 0, 1)
    return mat
  }
  const publishMats = [
    publishMaterial(state[0].texture),
    publishMaterial(state[1].texture),
  ] as const

  // ---------- Display ----------
  const displayMat = new THREE.MeshBasicNodeMaterial()
  displayMat.colorNode = Fn(() => {
    // Cover fit + feature-size zoom, so cells stay square on any aspect.
    const sx = min(u.aspect, 1)
    const sy = min(float(1).div(u.aspect), 1)
    const q = uv().sub(0.5).mul(vec2(sx, sy)).mul(u.view).add(0.5).toVar()
    const sampleV = (o: N) => texture(display.texture, o).y
    const V = sampleV(q).toVar()

    const w = max(float(0.6).sub(u.contrast.mul(0.55)), 0.02)
    const t = smoothstep(u.threshold.sub(w), u.threshold.add(w), V).toVar()
    const wall = hueRotate(u.colorWall, u.hueShift)
    const cellCol = hueRotate(u.colorCell, u.hueShift)
    const low = mix(u.colorBackground, wall, clamp(t.mul(2), 0, 1))
    const high = mix(wall, cellCol, clamp(t.mul(2).sub(1), 0, 1))
    const color = select(t.greaterThan(0.5), high, low).toVar()

    // Relief: V as a height field, one directional light (Lambert + Blinn sheen).
    const eps = 1.5 * texel
    const gx = sampleV(q.add(vec2(eps, 0)))
      .sub(sampleV(q.sub(vec2(eps, 0))))
      .mul(RELIEF_STRENGTH)
    const gy = sampleV(q.add(vec2(0, eps)))
      .sub(sampleV(q.sub(vec2(0, eps))))
      .mul(RELIEF_STRENGTH)
    const nrm = normalize(vec3(gx.negate(), gy.negate(), 1)).toVar()
    const ang = u.lightAngle.mul(Math.PI / 180)
    const lightDir = normalize(
      vec3(cos(ang).mul(RELIEF_LIGHT_XY), sin(ang).mul(RELIEF_LIGHT_XY), RELIEF_LIGHT_Z),
    ).toVar()
    const diff = clamp(dot(nrm, lightDir), 0, 1)
    const shade = diff.mul(1 - RELIEF_AMBIENT).add(RELIEF_AMBIENT)
    const halfVec = normalize(lightDir.add(vec3(0, 0, 1)))
    const spec = pow(clamp(dot(nrm, halfVec), 0, 1), RELIEF_SHININESS).mul(RELIEF_SPEC)
    const lit = color.mul(shade).add(spec)
    const out = mix(color, lit, u.relief).mul(u.brightness)
    // Display-space -> linear, so the renderer's sRGB output restores it.
    return vec4(pow(max(out, vec3(0)), vec3(2.2)), 1)
  })()

  return { u, state, display, seedMat, stepMats, publishMats, displayMat }
}

class ReactionDiffusion implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly b: ReturnType<typeof build>
  private readonly quad = new THREE.QuadMesh()
  private width: number
  private height: number

  /** Index of the state target holding the current field. */
  private cur = 0
  private stepAcc = 0
  private lastRegime = ''
  private needsSeed = true
  private needsClear = false
  private lastBloom = 0
  private lightPhase = 0
  private readonly brush = { active: false, id: -1, x: 0, y: 0, dx: 0, dy: 0, moved: false }

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    this.width = ctx.width
    this.height = ctx.height
    const n = Number(ctx.params.gridSize) || 512
    this.b = build([256, 512, 1024].includes(n) ? n : 512)
  }

  /** Seed and draw once, so shader compile errors surface while the scene loads. */
  init(p: Readonly<ParamValues>) {
    this.syncUniforms(p, 0)
    this.render(p, 0)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  action(key: string) {
    if (key === 'reseed') this.needsSeed = true
    else if (key === 'clear') this.needsClear = true
  }

  pointer(ev: ScenePointerEvent) {
    const b = this.brush
    const w = Math.max(this.canvas.clientWidth, 1)
    const h = Math.max(this.canvas.clientHeight, 1)
    const x = ev.x / w
    const y = ev.y / h
    if (ev.type === 'down') {
      if (b.active) return
      Object.assign(b, { active: true, id: ev.id, x, y, dx: 0, dy: 0, moved: false })
    } else if (b.active && ev.id === b.id) {
      if (ev.type === 'move') {
        b.dx += x - b.x
        b.dy += y - b.y
        b.x = x
        b.y = y
        b.moved = true
      } else {
        b.active = false
        b.id = -1
      }
    }
  }

  /** Screen uv (top-left origin, like the QuadMesh uv) -> field uv. */
  private toField(sx: number, sy: number): [number, number] {
    const aspect = this.width / Math.max(this.height, 1)
    const view = this.b.u.view.value as number
    return [
      (sx - 0.5) * Math.min(aspect, 1) * view + 0.5,
      (sy - 0.5) * Math.min(1 / aspect, 1) * view + 0.5,
    ]
  }

  /** Fill the splat slots for this frame's first step; returns how many are live. */
  private queueSplats(p: Readonly<ParamValues>): number {
    const slots = this.b.u.splats
    let i = 0
    const view = this.b.u.view.value as number
    const put = (fx: number, fy: number, radius: number, strength: number) => {
      if (i >= slots.length) return
      ;(slots[i++]!.value as THREE.Vector4).set(fx, fy, radius, strength)
    }

    // Mouse brush: velocity-scaled, like the original.
    const b = this.brush
    // A move counts even if the button was released before this frame (fast flicks).
    if (b.moved) {
      const speed = Math.hypot(b.dx, b.dy)
      const strength = num(p.brushStrength, 0.6) * Math.min(speed / 0.02, 1)
      if (strength > 0) {
        const [fx, fy] = this.toField(b.x, b.y)
        put(fx, fy, num(p.brushSize, 0.04) * view, strength)
      }
    }
    b.dx = 0
    b.dy = 0
    b.moved = false

    // Blooms: each rise of the (impulse-driven) bloom param drops reagent at random spots.
    const bloom = num(p.bloom, 0)
    if (bloom - this.lastBloom > 0.05) {
      const count = Math.max(1, Math.round(num(p.bloomCount, 2)))
      for (let k = 0; k < count; k++) {
        const [fx, fy] = this.toField(0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8)
        put(fx, fy, num(p.bloomSize, 0.03) * view, Math.min(bloom, 1))
      }
    }
    this.lastBloom = bloom

    for (let k = i; k < slots.length; k++) (slots[k]!.value as THREE.Vector4).set(0, 0, 0, 0)
    return i
  }

  private clearSplats() {
    for (const s of this.b.u.splats) (s.value as THREE.Vector4).w = 0
  }

  private syncUniforms(p: Readonly<ParamValues>, dt: number) {
    const u = this.b.u
    const regime = String(p.regime ?? 'coral')
    if (regime !== this.lastRegime) {
      this.lastRegime = regime
      this.needsSeed = true
    }
    const fk = operatingPoint(
      regime,
      { feed: num(p.feed, 0.0545), kill: num(p.kill, 0.062) },
      { feed: num(p.feedShift, 0), kill: num(p.killShift, 0) },
    )
    u.feed.value = fk.feed
    u.kill.value = fk.kill
    u.dv.value = num(p.diffusionRatio, 0.5)
    u.view.value = 1 / Math.max(num(p.featureSize, 3), 1e-3)
    u.aspect.value = this.width / Math.max(this.height, 1)
    ;(u.colorBackground.value as THREE.Vector3).fromArray(hexToRgb(String(p.colorBackground ?? '')))
    ;(u.colorWall.value as THREE.Vector3).fromArray(hexToRgb(String(p.colorWall ?? '#38bdf8')))
    ;(u.colorCell.value as THREE.Vector3).fromArray(hexToRgb(String(p.colorCell ?? '#e2f5ff')))
    u.hueShift.value = num(p.hueShift, 0)
    u.contrast.value = num(p.contrast, 0.5)
    u.threshold.value = num(p.threshold, 0.28)
    u.relief.value = num(p.relief, 0.4)
    this.lightPhase = (this.lightPhase + dt * num(p.lightSpin, 0) * 36) % 360
    u.lightAngle.value = num(p.lightAngle, 135) + this.lightPhase
    u.brightness.value = num(p.brightness, 1)
  }

  private render(p: Readonly<ParamValues>, dt: number) {
    const r = this.renderer
    const b = this.b
    const quad = this.quad
    const prevTarget = r.getRenderTarget()

    if (this.needsSeed || this.needsClear) {
      b.u.seed.value = Math.floor(Math.random() * 1e6)
      b.u.seedDensity.value = this.needsSeed ? SEED_DENSITY : 0
      quad.material = b.seedMat
      r.setRenderTarget(b.state[0])
      quad.render(r)
      this.cur = 0
      this.needsSeed = false
      this.needsClear = false
    }

    // Steps per 60 Hz frame, remainder carried over.
    const rate = p.paused === true ? 0 : Math.max(num(p.speed, 6), 0)
    this.stepAcc = Math.min(this.stepAcc + rate * Math.min(dt, 0.1) * 60, MAX_STEPS_PER_FRAME)
    const steps = Math.floor(this.stepAcc)
    this.stepAcc -= steps

    // Splats only land on a step; without one they wait for the next frame.
    if (steps > 0) this.queueSplats(p)
    for (let s = 0; s < steps; s++) {
      quad.material = b.stepMats[this.cur as 0 | 1]
      r.setRenderTarget(b.state[(1 - this.cur) as 0 | 1])
      quad.render(r)
      this.cur = 1 - this.cur
      if (s === 0) this.clearSplats()
    }

    quad.material = b.publishMats[this.cur as 0 | 1]
    r.setRenderTarget(b.display)
    quad.render(r)

    r.setRenderTarget(prevTarget)
    quad.material = b.displayMat
    quad.render(r)
  }

  update(frame: SceneFrame) {
    this.syncUniforms(frame.params, frame.dt)
    this.render(frame.params, frame.dt)
  }

  dispose() {
    const b = this.b
    b.state[0].dispose()
    b.state[1].dispose()
    b.display.dispose()
    b.seedMat.dispose()
    b.stepMats.forEach((m) => m.dispose())
    b.publishMats.forEach((m) => m.dispose())
    b.displayMat.dispose()
  }
}

export function createScene(ctx: SceneContext): SceneInstance {
  const scene = new ReactionDiffusion(ctx)
  scene.init(ctx.params)
  return scene
}
