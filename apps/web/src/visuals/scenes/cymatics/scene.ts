/**
 * Cymatics - TSL port of Sidmaz666's Chladni plate simulator (see
 * ./definition.ts for credit). Structure follows the original:
 *
 *   plate modes (m, n, amp) x4  ->  per-grain force  F = -grad |z|^2
 *   -> waveform shaping + noise  ->  damped velocity, wrapped position
 *   -> additive round sprites coloured by "life" (slow grains glow)
 *
 * with z(x, y) = sum amp * (cos(m pi x/L) cos(n pi y/L) - cos(n pi x/L) cos(m pi y/L)).
 *
 * Porting notes:
 * - The original integrates every grain on the CPU and uploads the buffers
 *   each frame; here one compute pass updates a vec4 (pos.xy, vel.xy) per
 *   grain in a storage buffer that the sprites read as an instanced attribute.
 * - The gradient is analytic instead of finite differences.
 * - The original steps once per frame; the step is scaled by dt * 60 so the
 *   motion is the same at any refresh rate.
 * - Points become instanced sprites (WebGPU has no point size); the size
 *   param stays in CSS pixels.
 * - Colour schemes are display-space colours, linearised so the renderer's
 *   sRGB output lands them where the original did.
 * - Helpers that read uniforms are plain JS builders, not `setLayout`
 *   functions (two materials share them; see docs/known-issues.md).
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  abs,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mix,
  positionLocal,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  varying,
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
import { MAX_MODES, PATTERN_PRESETS, type PlateMode, modesFromFrequency } from './patterns'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

/** Plate half-size, the original's default `plateSize`. */
const L = 2
const K = Math.PI / L

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'] as const
const PALETTES = ['classic', 'rainbow', 'heat', 'ocean', 'neon', 'custom'] as const

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Display-space colour from '#rrggbb' (no colour management, like the original). */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function makeUniforms() {
  return {
    modes: Array.from({ length: MAX_MODES }, () => uniform(new THREE.Vector3())),
    dt: uniform(0),
    stepScale: uniform(1),
    force: uniform(1),
    damping: uniform(0.98),
    noise: uniform(0.15),
    seed: uniform(0),
    waveform: uniform(0),
    palette: uniform(0),
    colorPhase: uniform(0),
    hueShift: uniform(0),
    colorA: uniform(new THREE.Vector3(0, 1, 0.53)),
    colorB: uniform(new THREE.Vector3(1, 0, 0.4)),
    brightness: uniform(1),
    glow: uniform(0.3),
    size: uniform(0.01),
    fieldOverlay: uniform(0),
    fieldNorm: uniform(1),
  }
}
type Uniforms = ReturnType<typeof makeUniforms>

/** z and its analytic gradient at plate position p. Returns vec3(z, dz/dx, dz/dy). */
function plateField(u: Uniforms, p: N, withGradient: boolean): N {
  const ax = p.x.mul(K)
  const ay = p.y.mul(K)
  const out = vec3(0).toVar()
  for (const mode of u.modes) {
    const m = mode.x
    const n = mode.y
    const a = mode.z
    const mx = ax.mul(m)
    const nx = ax.mul(n)
    const my = ay.mul(m)
    const ny = ay.mul(n)
    const cmx = cos(mx)
    const cnx = cos(nx)
    const cmy = cos(my)
    const cny = cos(ny)
    const z = cmx.mul(cny).sub(cnx.mul(cmy))
    if (!withGradient) {
      out.x.addAssign(a.mul(z))
      continue
    }
    const dx = n
      .mul(sin(nx))
      .mul(cmy)
      .sub(m.mul(sin(mx)).mul(cny))
      .mul(K)
    const dy = m
      .mul(cnx)
      .mul(sin(my))
      .sub(n.mul(cmx).mul(sin(ny)))
      .mul(K)
    out.addAssign(vec3(z, dx, dy).mul(a))
  }
  return out
}

/** The original's colour schemes, display space, by `u.palette` index. */
function paletteColor(u: Uniforms, life: N, intensity: N): N {
  const b = life.mul(0.4).add(0.6)
  const classic = vec3(b.mul(0.95), b.mul(0.85), b.mul(0.75))

  // HSV with s = 0.7, v = b
  const hueRgb = clamp(
    abs(
      fract(u.colorPhase.add(vec3(0, 2 / 3, 1 / 3)))
        .mul(6)
        .sub(3),
    ).sub(1),
    0,
    1,
  )
  const rainbow = mix(vec3(1), hueRgb, 0.7).mul(b)

  const th = life.mul(0.8).add(intensity.mul(0.2))
  const heat = select(
    th.lessThan(0.5),
    mix(vec3(0, 0, 0.3), vec3(0.8, 0.2, 0), th.mul(2)),
    mix(vec3(0.8, 0.2, 0), vec3(1, 1, 0.8), clamp(th.sub(0.5).mul(2), 0, 1)),
  )

  const to = life.mul(0.7).add(intensity.mul(0.3))
  const ocean = mix(vec3(0, 0.1, 0.3), mix(vec3(0, 0.5, 0.7), vec3(0.8, 1, 1), to), to)

  const cycle = sin(u.colorPhase.mul(40)).mul(0.5).add(0.5)
  const neon = mix(mix(vec3(1, 0, 0.6), vec3(0, 1, 1), cycle), vec3(0.6, 0, 1), life).mul(
    life.mul(0.4).add(0.8),
  )

  const custom = mix(u.colorA, u.colorB, clamp(to, 0, 1))

  const i = u.palette
  return select(
    i.lessThan(0.5),
    classic,
    select(
      i.lessThan(1.5),
      rainbow,
      select(
        i.lessThan(2.5),
        heat,
        select(i.lessThan(3.5), ocean, select(i.lessThan(4.5), neon, custom)),
      ),
    ),
  )
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

/** Display-space -> linear, so the renderer's sRGB output restores it. */
const toLinear = (c: N) => pow(max(c, vec3(0)), vec3(2.2))

function build(count: number) {
  const u = makeUniforms()
  const state = instancedArray(count, 'vec4')

  const init = Fn(() => {
    const s = state.element(instanceIndex)
    const i = instanceIndex.toFloat().add(u.seed)
    const x = hash(i)
      .sub(0.5)
      .mul(2 * L)
    const y = hash(i.add(1.5e6))
      .sub(0.5)
      .mul(2 * L)
    const vx = hash(i.add(3e6)).sub(0.5).mul(0.01)
    const vy = hash(i.add(4.5e6)).sub(0.5).mul(0.01)
    s.assign(vec4(x, y, vx, vy))
  })().compute(count)

  const step = Fn(() => {
    const s = state.element(instanceIndex)
    const pos = s.xy.toVar()
    const vel = s.zw.toVar()

    const f = plateField(u, pos, true).toVar()
    // F = -grad |z|^2 = -2 z grad z
    const g = f.yz.mul(f.x).mul(-2).toVar()
    const mag = length(g).toVar()
    const w = u.waveform
    If(w.greaterThan(0.5).and(w.lessThan(1.5)), () => {
      // square: cap the force
      g.assign(select(mag.lessThan(1e-10), vec2(0), g.mul(min(0.08, mag).div(max(mag, 1e-10)))))
    })
      .ElseIf(w.greaterThan(1.5).and(w.lessThan(2.5)), () => {
        // sawtooth: swirl
        g.assign(vec2(g.x.add(g.y.mul(0.35)), g.y.sub(g.x.mul(0.35))))
      })
      .ElseIf(w.greaterThan(2.5), () => {
        // triangle: soften
        g.mulAssign(sqrt(mag).div(mag.add(0.001)))
      })

    const i = instanceIndex.toFloat().add(u.seed)
    const rnd = vec2(hash(i), hash(i.add(1.5e6)))
      .sub(0.5)
      .mul(u.noise)
      .mul(0.1)
    vel.addAssign(g.mul(u.force).mul(0.01).add(rnd).mul(u.dt))
    vel.mulAssign(u.damping)
    pos.addAssign(vel.mul(u.stepScale))
    // Wrap onto the plate
    pos.assign(pos.sub(floor(pos.add(L).div(2 * L)).mul(2 * L)))
    s.assign(vec4(pos, vel))
  })().compute(count)

  // ---------- Sand ----------
  const attr = state.toAttribute()
  const speed = length(attr.zw)
  const life = clamp(float(1).sub(speed.mul(5)), 0.1, 1)
  const vLife = varying(life)
  const vIntensity = varying(speed.mul(10))

  const sandMat = new THREE.SpriteNodeMaterial()
  sandMat.positionNode = vec3(attr.xy, 0)
  sandMat.scaleNode = u.size.mul(life.mul(0.5).add(0.5))
  const col = hueRotate(paletteColor(u, vLife, vIntensity), u.hueShift)
    .mul(u.brightness)
    .mul(u.glow.mul(0.3).add(1))
  sandMat.colorNode = toLinear(col)
  const d = length(uv().sub(0.5))
  sandMat.opacityNode = float(1)
    .sub(smoothstep(0.3, 0.5, d))
    .mul(vLife)
  sandMat.transparent = true
  sandMat.blending = THREE.AdditiveBlending
  sandMat.depthWrite = false
  sandMat.depthTest = false

  // ---------- Field overlay (|z|^2 under the sand) ----------
  const fieldMat = new THREE.MeshBasicNodeMaterial()
  // plateField declares vars, so it needs a Fn stack here too.
  const z = Fn(() => plateField(u, positionLocal.xy, false).x)()
  const energy = sqrt(clamp(z.mul(z).div(u.fieldNorm), 0, 1))
  const fieldCol = hueRotate(paletteColor(u, energy, energy), u.hueShift)
  fieldMat.colorNode = toLinear(fieldCol).mul(energy.mul(u.fieldOverlay))
  fieldMat.transparent = true
  fieldMat.blending = THREE.AdditiveBlending
  fieldMat.depthWrite = false
  fieldMat.depthTest = false

  return { u, init, step, sandMat, fieldMat }
}

class Cymatics implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
  private readonly built: ReturnType<typeof build>
  private readonly sand: THREE.Sprite
  private readonly field: THREE.Mesh
  private readonly fieldGeometry = new THREE.PlaneGeometry(2 * L, 2 * L)

  private width: number
  private height: number
  private readonly current: { m: number; n: number; amp: number }[] = Array.from(
    { length: MAX_MODES },
    () => ({ m: 3, n: 5, amp: 0 }),
  )
  private firstFrame = true
  private lastHz = 220
  private colorPhase = 0
  private needsScatter = false
  private readonly pan = { x: 0, y: 0 }
  private readonly drag = { active: false, id: -1, x: 0, y: 0 }
  // Renderer.getClearColor wants a Color4 (not exported); only rgb is read back here.
  private readonly prevClear = new THREE.Color() as THREE.Color & { a: number }
  private readonly bg = new THREE.Color()

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    this.width = ctx.width
    this.height = ctx.height
    const count = Math.max(1000, Math.round(num(ctx.params.particleCount, 60000)))
    this.built = build(count)

    this.field = new THREE.Mesh(this.fieldGeometry, this.built.fieldMat)
    this.field.frustumCulled = false
    this.field.renderOrder = 0
    this.scene.add(this.field)

    this.sand = new THREE.Sprite(this.built.sandMat)
    this.sand.count = count
    this.sand.frustumCulled = false
    this.sand.renderOrder = 1
    this.scene.add(this.sand)
  }

  async init() {
    this.built.u.seed.value = Math.floor(Math.random() * 1e6)
    await this.renderer.computeAsync(this.built.init)
    await this.renderer.compileAsync(this.scene, this.camera)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  action(key: string) {
    if (key === 'scatter') this.needsScatter = true
    else if (key === 'resetView') {
      this.pan.x = 0
      this.pan.y = 0
    }
  }

  pointer(ev: ScenePointerEvent) {
    const d = this.drag
    if (ev.type === 'down') {
      if (d.active) return
      d.active = true
      d.id = ev.id
      d.x = ev.x
      d.y = ev.y
    } else if (d.active && ev.id === d.id) {
      if (ev.type === 'move') {
        // CSS px -> plate units at the current view scale
        const perPx = (2 * this.camera.top) / Math.max(this.canvas.clientHeight, 1)
        this.pan.x -= (ev.x - d.x) * perPx
        this.pan.y += (ev.y - d.y) * perPx
        d.x = ev.x
        d.y = ev.y
      } else {
        d.active = false
        d.id = -1
      }
    }
  }

  /** Target modes for this frame, before glide. */
  private targetModes(frame: SceneFrame): PlateMode[] {
    const p = frame.params
    const pattern = String(p.pattern ?? 'pitch')
    let modes: PlateMode[]
    if (pattern === 'pitch') {
      if (frame.audio.hz > 0) this.lastHz = frame.audio.hz
      const f = this.lastHz * num(p.pitchScale, 1)
      const a = modesFromFrequency(f)
      const b = modesFromFrequency(f * 2)
      modes = [
        { m: a.m, n: a.n, amp: 1 },
        { m: b.m, n: b.n, amp: num(p.harmonics, 0.3) },
      ]
    } else if (pattern === 'manual') {
      modes = [1, 2, 3].map((i) => ({
        m: num(p[`m${i}`], 3),
        n: num(p[`n${i}`], 5),
        amp: num(p[`amp${i}`], 0),
      }))
    } else {
      modes = [...(PATTERN_PRESETS.find((x) => x.id === pattern)?.modes ?? [])]
    }
    const quantize = p.quantize !== false
    const out: PlateMode[] = []
    for (let i = 0; i < MAX_MODES; i++) {
      const m = modes[i]
      if (!m) out.push({ m: this.current[i]!.m, n: this.current[i]!.n, amp: 0 })
      else
        out.push({
          m: quantize ? Math.round(m.m) : m.m,
          n: quantize ? Math.round(m.n) : m.n,
          amp: m.amp,
        })
    }
    return out
  }

  private updateModes(frame: SceneFrame) {
    const target = this.targetModes(frame)
    const glide = num(frame.params.morphTime, 0.2)
    const k = this.firstFrame || glide <= 0 ? 1 : 1 - Math.exp(-frame.dt / glide)
    let ampSum = 0
    for (let i = 0; i < MAX_MODES; i++) {
      const c = this.current[i]!
      const t = target[i]!
      // A silent slot jumps straight to its new modes instead of gliding through others.
      const jump = k === 1 || c.amp < 1e-3
      c.m = jump ? t.m : c.m + (t.m - c.m) * k
      c.n = jump ? t.n : c.n + (t.n - c.n) * k
      c.amp += (t.amp - c.amp) * k
      ;(this.built.u.modes[i]!.value as THREE.Vector3).set(c.m, c.n, c.amp)
      ampSum += Math.abs(c.amp)
    }
    this.built.u.fieldNorm.value = Math.max(4 * ampSum * ampSum, 1e-4)
    this.firstFrame = false
  }

  private updateCamera(p: Readonly<ParamValues>) {
    const zoom = Math.max(1, num(p.zoom, 1))
    const aspect = this.width / Math.max(this.height, 1)
    // Cover: the plate fills the stage along its longer side.
    const halfW = (aspect >= 1 ? L : L * aspect) / zoom
    const halfH = (aspect >= 1 ? L / aspect : L) / zoom
    const maxX = Math.max(L - halfW, 0)
    const maxY = Math.max(L - halfH, 0)
    this.pan.x = Math.min(maxX, Math.max(-maxX, this.pan.x))
    this.pan.y = Math.min(maxY, Math.max(-maxY, this.pan.y))
    const cam = this.camera
    cam.left = this.pan.x - halfW
    cam.right = this.pan.x + halfW
    cam.top = this.pan.y + halfH
    cam.bottom = this.pan.y - halfH
    cam.updateProjectionMatrix()
    // Grain size: CSS px -> plate units
    const dpr = this.width / Math.max(this.canvas.clientWidth, 1)
    this.built.u.size.value =
      num(p.particleSize, 1.6) * dpr * ((2 * halfH) / Math.max(this.height, 1))
  }

  private syncUniforms(frame: SceneFrame) {
    const { dt, params: p } = frame
    const u = this.built.u
    const ts = p.paused === true ? 0 : num(p.timeScale, 1)
    const dtc = Math.min(dt, 0.05) * ts
    u.dt.value = dtc
    u.stepScale.value = dtc * 60
    // The original damps once per 60 Hz frame.
    u.damping.value = Math.pow(num(p.damping, 0.98), dtc * 60)
    u.force.value = num(p.vibration, 1) * num(p.speed, 1)
    u.noise.value = num(p.noise, 0.15) + num(p.shake, 0) * 2
    u.seed.value = Math.floor(Math.random() * 1e6)

    const wf = WAVEFORMS.indexOf(String(p.waveform) as (typeof WAVEFORMS)[number])
    u.waveform.value = Math.max(wf, 0)
    const pal = PALETTES.indexOf(String(p.palette) as (typeof PALETTES)[number])
    u.palette.value = Math.max(pal, 0)

    this.colorPhase = (this.colorPhase + dt * ts * num(p.colorCycle, 0.05)) % 1
    u.colorPhase.value = this.colorPhase
    u.hueShift.value = num(p.hueShift, 0)
    u.brightness.value = num(p.brightness, 1)
    u.glow.value = num(p.glow, 0.3)
    u.fieldOverlay.value = num(p.fieldOverlay, 0)
    this.field.visible = u.fieldOverlay.value > 0.001
    ;(u.colorA.value as THREE.Vector3).fromArray(hexToRgb(String(p.colorA ?? '#00ff88')))
    ;(u.colorB.value as THREE.Vector3).fromArray(hexToRgb(String(p.colorB ?? '#ff0066')))
    this.bg.set(String(p.backgroundColor ?? '#0a0a0f'))
    return dtc > 0
  }

  update(frame: SceneFrame) {
    this.updateModes(frame)
    this.updateCamera(frame.params)
    const running = this.syncUniforms(frame)
    const r = this.renderer
    if (this.needsScatter) {
      this.needsScatter = false
      r.compute(this.built.init)
    }
    if (running) r.compute(this.built.step)

    r.getClearColor(this.prevClear)
    const prevAlpha = r.getClearAlpha()
    r.setClearColor(this.bg, 1)
    r.render(this.scene, this.camera)
    r.setClearColor(this.prevClear, prevAlpha)
  }

  dispose() {
    this.fieldGeometry.dispose()
    this.built.sandMat.dispose()
    this.built.fieldMat.dispose()
    this.built.init.dispose()
    this.built.step.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new Cymatics(ctx)
  await scene.init()
  return scene
}
