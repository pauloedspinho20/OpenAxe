/**
 * Fractal Studio - Julia set, Mandelbrot set and Mandelbulb as a fullscreen
 * TSL fragment shader (see ./definition.ts for credit). One material is built
 * per fractal kind; `iterations` / `raySteps` are compile-time loop bounds
 * (rebuild params), everything else is a uniform updated each frame.
 *
 * - Julia / Mandelbrot: smooth (continuous) escape-time colouring; the
 *   `detail` param scales the live iteration cap so strong bass can collapse
 *   the set into soft blobs.
 * - Mandelbulb: sphere-traced distance estimator with a modulatable power.
 *
 * Colour is composed in display space (like the other VISUALS scenes) and
 * linearised at the end so the renderer's sRGB encode restores it.
 */
import * as THREE from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  acos,
  atan,
  bool,
  clamp,
  cos,
  dot,
  exp,
  float,
  inverseSqrt,
  length,
  log,
  log2,
  max,
  mix,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  screenSize,
  sin,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import type { ParamValues, SceneContext, SceneFrame, SceneInstance } from '../../types'
import { juliaPreset } from './definition'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

const TAU = Math.PI * 2

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** '#rrggbb' -> display-space RGB 0..1. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

type Kind = 'julia' | 'mandelbrot' | 'mandelbulb'

function buildMaterial(kind: Kind, MAX_ITER: number, RAY_STEPS: number) {
  const u = {
    zoom: uniform(1),
    rotCS: uniform(new THREE.Vector2(1, 0)),
    c: uniform(new THREE.Vector2(-0.4, -0.59)),
    iterLimit: uniform(300),
    colorPhase: uniform(0),
    hue: uniform(0),
    bands: uniform(0.06),
    rainbow: uniform(0),
    glow: uniform(0.8),
    brightness: uniform(1),
    colA: uniform(new THREE.Vector3(1, 0.18, 0.58)),
    colB: uniform(new THREE.Vector3(0.18, 0.9, 1)),
    bg: uniform(new THREE.Vector3(0.02, 0.01, 0.05)),
    power: uniform(8),
    camDist: uniform(3),
    objRot: uniform(new THREE.Matrix3()),
  }

  // Cosine rainbow or a sine blend between the two picked colours.
  const palette = (t: N) => {
    const x = t.add(u.hue)
    const rb = cos(x.add(vec3(0.0, 0.33, 0.67)).mul(TAU))
      .mul(0.5)
      .add(0.5)
    const two = mix(u.colA, u.colB, sin(x.mul(TAU)).mul(0.5).add(0.5))
    return mix(two, rb, u.rainbow)
  }

  // ---------- 2D escape-time (Julia / Mandelbrot) ----------
  const render2D = (fragCoord: N): N => {
    const res = screenSize
    const uv = fragCoord.mul(2).sub(res).div(res.y)
    const rotated = vec2(
      uv.x.mul(u.rotCS.x).sub(uv.y.mul(u.rotCS.y)),
      uv.x.mul(u.rotCS.y).add(uv.y.mul(u.rotCS.x)),
    )
    const isJulia = kind === 'julia'
    const p = rotated.mul(isJulia ? 1.6 : 1.5).div(u.zoom)
    const start = isJulia ? p : vec2(0)
    const c = isJulia ? vec2(u.c) : p.add(vec2(-0.5, 0))

    const z = vec2(start).toVar()
    const n = float(0).toVar()
    const escaped = float(0).toVar()
    Loop(MAX_ITER, ({ i }: N) => {
      If(float(i).greaterThanEqual(u.iterLimit), () => {
        Break()
      })
      z.assign(vec2(z.x.mul(z.x).sub(z.y.mul(z.y)), z.x.mul(z.y).mul(2)).add(c))
      If(dot(z, z).greaterThan(256), () => {
        escaped.assign(1)
        Break()
      })
      n.addAssign(1)
    })

    // Smooth iteration count (only meaningful where escaped).
    const lz = log2(max(dot(z, z), 1.0001)).mul(0.5)
    const mu = n
      .add(1)
      .sub(log2(max(lz, 1e-4)))
      .toVar()
    const t = mu.mul(u.bands).add(u.colorPhase)
    const rim = float(1).add(u.glow.mul(0.25).mul(exp(mu.mul(-0.2))))
    const body = palette(t).mul(rim).mul(u.brightness)
    // Faint halo in the interior so detail collapse never goes flat black.
    const inner = mix(u.bg, palette(u.colorPhase), u.glow.mul(0.05))
    return mix(inner, body, escaped)
  }

  // ---------- Mandelbulb ----------
  const de = Fn(([pos]: N[]) => {
    const z = vec3(pos).toVar()
    const dr = float(1).toVar()
    const r = float(0).toVar()
    Loop(10, () => {
      r.assign(length(z))
      If(r.greaterThan(2), () => {
        Break()
      })
      const rs = max(r, 1e-6)
      const theta = acos(clamp(z.z.div(rs), -1, 1)).mul(u.power)
      const phi = atan(z.y, z.x).mul(u.power)
      const rp = pow(rs, u.power.sub(1))
      dr.assign(rp.mul(u.power).mul(dr).add(1))
      const zr = rp.mul(rs)
      z.assign(
        vec3(sin(theta).mul(cos(phi)), sin(theta).mul(sin(phi)), cos(theta))
          .mul(zr)
          .add(pos),
      )
    })
    return log(max(r, 1e-6)).mul(r).mul(0.5).div(dr)
  })

  const renderBulb = (fragCoord: N): N => {
    const res = screenSize
    const uv = fragCoord.mul(2).sub(res).div(res.y)
    const ro = u.objRot.mul(vec3(0, 0, u.camDist.negate())).toVar()
    const rd = u.objRot.mul(normalize(vec3(uv.x, uv.y, u.zoom.mul(1.6)))).toVar()

    const t = float(0).toVar()
    const steps = float(0).toVar()
    const hit = bool(false).toVar()
    Loop(RAY_STEPS, () => {
      const d = de(ro.add(rd.mul(t))).toVar()
      If(d.lessThan(t.mul(0.0008).add(0.0004)), () => {
        hit.assign(bool(true))
        Break()
      })
      t.addAssign(d.mul(0.9))
      steps.addAssign(1)
      If(t.greaterThan(8), () => {
        Break()
      })
    })

    const ao = float(1).sub(steps.div(RAY_STEPS)).toVar()
    const col = u.bg.toVar()
    // Glow from near misses: bright where the ray lingered close to the surface.
    col.addAssign(palette(u.colorPhase).mul(float(1).sub(ao).mul(u.glow).mul(0.6)))
    If(hit, () => {
      const p = ro.add(rd.mul(t)).toVar()
      const h = float(0.001)
      const k1 = vec3(1, -1, -1)
      const k2 = vec3(-1, -1, 1)
      const k3 = vec3(-1, 1, -1)
      const k4 = vec3(1, 1, 1)
      const g = k1
        .mul(de(p.add(k1.mul(h))))
        .add(k2.mul(de(p.add(k2.mul(h)))))
        .add(k3.mul(de(p.add(k3.mul(h)))))
        .add(k4.mul(de(p.add(k4.mul(h)))))
        .toVar()
      const n = g.mul(inverseSqrt(max(dot(g, g), 1e-12))).toVar()
      const light = normalize(vec3(0.6, 0.8, -0.5))
      const dif = clamp(dot(n, light), 0, 1)
      const base = palette(length(p).mul(u.bands).mul(6).add(n.y.mul(0.1)).add(u.colorPhase))
      col.assign(
        base
          .mul(dif.mul(0.75).add(0.25))
          .mul(ao.mul(0.8).add(0.2))
          .mul(u.brightness)
          .add(base.mul(u.glow).mul(0.08)),
      )
    })
    return col
  }

  const fragment = Fn(() => {
    // TSL's screenCoordinate is top-left on both backends; flip to bottom-left.
    const fc = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))
    const col = kind === 'mandelbulb' ? renderBulb(fc) : render2D(fc)
    // Display-space result -> linear, so the renderer's sRGB encode restores it.
    return vec4(pow(max(col, vec3(0)), vec3(2.2)), 1)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.fragmentNode = fragment()
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return { material, u }
}

class FractalStudio implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicNodeMaterial
  private readonly u: ReturnType<typeof buildMaterial>['u']
  private readonly kind: Kind
  private readonly maxIter: number

  private readonly anim = { time: 0, rot: 0, color: 0 }

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    const p = ctx.params
    const f = String(p.fractal)
    this.kind = f === 'mandelbrot' || f === 'mandelbulb' ? f : 'julia'
    this.maxIter = Math.max(1, Math.round(num(p.iterations, 300)))
    const built = buildMaterial(this.kind, this.maxIter, Math.round(num(p.raySteps, 100)))
    this.material = built.material
    this.u = built.u
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    const mesh = new THREE.Mesh(this.geometry, this.material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  async compile() {
    await this.renderer.compileAsync(this.scene, this.camera)
  }

  resize() {
    // screenSize is read from the renderer each frame; nothing to do.
  }

  action(key: string) {
    if (key === 'resetTime') {
      this.anim.time = 0
      this.anim.rot = 0
      this.anim.color = 0
    }
  }

  private advance(dt: number, p: Readonly<ParamValues>) {
    const t = p.paused === true ? 0 : dt * num(p.timeScale, 1)
    this.anim.time += t
    this.anim.rot += t * num(p.rotSpeed, 0.3)
    this.anim.color += t * num(p.colorSpeed, 0.05)
  }

  private sync(p: Readonly<ParamValues>) {
    const u = this.u
    const a = this.anim
    const breathe = 1 + num(p.breathe, 0.03) * Math.sin(a.time * 0.3)
    u.zoom.value = Math.max(0.1, num(p.zoom, 1) * breathe)

    // 2D fractals spin gently; the bulb uses the full rotation matrix below.
    const ang = a.rot * 0.25
    ;(u.rotCS.value as THREE.Vector2).set(Math.cos(ang), Math.sin(ang))

    const preset = juliaPreset(p.juliaPreset)
    const cx = preset ? preset.cx : num(p.juliaCx, -0.4)
    const cy = preset ? preset.cy : num(p.juliaCy, -0.59)
    ;(u.c.value as THREE.Vector2).set(
      cx + num(p.wobbleX, 0) * Math.sin(a.time * 0.7),
      cy + num(p.wobbleY, 0) * Math.cos(a.time * 0.5),
    )

    u.iterLimit.value = Math.max(4, num(p.detail, 1) * this.maxIter)
    u.colorPhase.value = a.color
    u.hue.value = num(p.hueShift, 0)
    u.bands.value = num(p.bands, 0.06)
    u.rainbow.value = p.rainbow === true ? 1 : 0
    u.glow.value = num(p.glow, 0.8)
    u.brightness.value = num(p.brightness, 1)

    const [ar, ag, ab] = hexToRgb(String(p.colorA ?? '#ff2e93'))
    const [br, bg, bb] = hexToRgb(String(p.colorB ?? '#2ee6ff'))
    const [gr, gg, gb] = hexToRgb(String(p.backgroundColor ?? '#05020d'))
    ;(u.colA.value as THREE.Vector3).set(ar, ag, ab)
    ;(u.colB.value as THREE.Vector3).set(br, bg, bb)
    ;(u.bg.value as THREE.Vector3).set(gr, gg, gb)

    // Mandelbulb: breathing power plus audio, clamped to a range that stays solid.
    u.power.value = THREE.MathUtils.clamp(
      num(p.power, 8) + num(p.powerKick, 0) + Math.sin(a.time * 0.4),
      2,
      20,
    )
    u.camDist.value = num(p.camDistance, 3)
    const cy2 = Math.cos(a.rot)
    const sy = Math.sin(a.rot)
    const cx2 = Math.cos(0.35)
    const sx = Math.sin(0.35)
    // rotY * rotX (row-major), same convention as the other scenes.
    ;(u.objRot.value as THREE.Matrix3).set(
      cy2,
      sy * sx,
      sy * cx2,
      0,
      cx2,
      -sx,
      -sy,
      cy2 * sx,
      cy2 * cx2,
    )
  }

  update(frame: SceneFrame) {
    this.advance(frame.dt, frame.params)
    this.sync(frame.params)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new FractalStudio(ctx)
  await scene.compile()
  return scene
}
