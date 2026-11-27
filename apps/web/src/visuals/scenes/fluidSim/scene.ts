/**
 * Fluid Simulation - Navier-Stokes on the GPU (see ./definition.ts for
 * credit). Velocity, pressure, curl, divergence and dye live in half-float
 * render targets; each solver stage is a fullscreen TSL pass (QuadMesh) that
 * reads one or two of them and writes another. Fields that are updated in
 * place (velocity, pressure, dye) are ping-ponged.
 *
 * Each pass owns its material and uniforms, and no pass shares a layout
 * function with another (see "A layout function shared by several materials
 * loses its uniforms" in docs/known-issues.md).
 */
import * as THREE from 'three/webgpu'
import {
  abs,
  clamp,
  dot,
  Fn,
  exp,
  float,
  length,
  max,
  normalize,
  pow,
  select,
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

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** '#rrggbb' -> display-space RGB 0..1. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (((i % 6) + 6) % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

/** Sim grid for a resolution: the shorter side gets `res` cells. */
export function gridSize(res: number, aspect: number): [number, number] {
  const a = aspect < 1 ? 1 / aspect : aspect
  const min = Math.max(2, Math.round(res))
  const max = Math.max(2, Math.round(res * a))
  return aspect > 1 ? [max, min] : [min, max]
}

function makeTarget(w: number, h: number): THREE.RenderTarget {
  const rt = new THREE.RenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  })
  rt.texture.generateMipmaps = false
  rt.texture.wrapS = THREE.ClampToEdgeWrapping
  rt.texture.wrapT = THREE.ClampToEdgeWrapping
  return rt
}

/** A read/write pair for a field that is updated in place. */
class Double {
  read: THREE.RenderTarget
  write: THREE.RenderTarget
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.read = makeTarget(width, height)
    this.write = makeTarget(width, height)
  }
  swap() {
    const t = this.read
    this.read = this.write
    this.write = t
  }
  dispose() {
    this.read.dispose()
    this.write.dispose()
  }
}

/** A fullscreen pass: one material, its texture slots, and its uniforms. */
class Pass {
  readonly material = new THREE.NodeMaterial()
  private readonly quad: THREE.QuadMesh
  constructor(fragment: () => N) {
    this.material.fragmentNode = Fn(fragment)()
    this.material.depthTest = false
    this.material.depthWrite = false
    this.material.toneMapped = false
    this.quad = new THREE.QuadMesh(this.material)
  }
  render(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget | null) {
    renderer.setRenderTarget(target)
    this.quad.render(renderer)
  }
  compile(renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
    return renderer.compileAsync(this.quad, camera)
  }
  dispose() {
    this.material.dispose()
  }
}

interface Color3 {
  r: number
  g: number
  b: number
}

const nbrs = (t: N, vUv: N, tx: N) => ({
  c: t.sample(vUv),
  l: t.sample(vUv.sub(vec2(tx.x, 0))),
  r: t.sample(vUv.add(vec2(tx.x, 0))),
  t: t.sample(vUv.add(vec2(0, tx.y))),
  b: t.sample(vUv.sub(vec2(0, tx.y))),
})

/*
 * One maker per solver stage. A maker binds its input textures once, when the
 * pass is created: a material that is re-bound to a different texture between
 * draws can keep sampling a stale one, so every (stage, textures) combination
 * gets its own pass (see `FluidSim.pass`). Uniforms are per pass instance and
 * are set right before each draw.
 */
const makeSplat = (target: THREE.Texture) => {
  const vUv = uv()
  const src = texture(target)
  const point = uniform(new THREE.Vector2(0.5, 0.5))
  const color = uniform(new THREE.Vector3())
  const aspect = uniform(1)
  const radius = uniform(0.0025)
  const pass = new Pass(() => {
    const p = vUv.sub(point).toVar()
    p.x.mulAssign(aspect)
    const s = exp(dot(p, p).negate().div(radius))
    return vec4(src.sample(vUv).xyz.add(color.mul(s)), 1)
  })
  return { pass, point, color, aspect, radius }
}

const makeAdvect = (velocityTex: THREE.Texture, sourceTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const velocity = texture(velocityTex)
  const source = texture(sourceTex)
  const tx = uniform(txv)
  const dt = uniform(0.016)
  const dissipation = uniform(0.2)
  const pass = new Pass(() => {
    const coord = vUv.sub(velocity.sample(vUv).xy.mul(tx).mul(dt))
    return vec4(source.sample(coord).xyz.div(dissipation.mul(dt).add(1)), 1)
  })
  return { pass, dt, dissipation }
}

const makeDivergence = (velocityTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const velocity = texture(velocityTex)
  const tx = uniform(txv)
  const pass = new Pass(() => {
    const n = nbrs(velocity, vUv, tx)
    // Reflect at the walls so fluid doesn't leak out of the box.
    const l = select(vUv.x.sub(tx.x).lessThan(0), n.c.x.negate(), n.l.x)
    const r = select(vUv.x.add(tx.x).greaterThan(1), n.c.x.negate(), n.r.x)
    const t = select(vUv.y.add(tx.y).greaterThan(1), n.c.y.negate(), n.t.y)
    const b = select(vUv.y.sub(tx.y).lessThan(0), n.c.y.negate(), n.b.y)
    return vec4(r.sub(l).add(t.sub(b)).mul(0.5), 0, 0, 1)
  })
  return { pass }
}

const makeCurl = (velocityTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const velocity = texture(velocityTex)
  const tx = uniform(txv)
  const pass = new Pass(() => {
    const n = nbrs(velocity, vUv, tx)
    return vec4(n.r.y.sub(n.l.y).sub(n.t.x).add(n.b.x).mul(0.5), 0, 0, 1)
  })
  return { pass }
}

const makeVorticity = (velocityTex: THREE.Texture, curlTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const velocity = texture(velocityTex)
  const curl = texture(curlTex)
  const tx = uniform(txv)
  const strength = uniform(30)
  const dt = uniform(0.016)
  const pass = new Pass(() => {
    const n = nbrs(curl, vUv, tx)
    const force = vec2(abs(n.t.x).sub(abs(n.b.x)), abs(n.r.x).sub(abs(n.l.x)))
      .mul(0.5)
      .toVar()
    force.assign(force.div(length(force).add(0.0001)))
    force.assign(force.mul(strength).mul(n.c.x))
    force.y.mulAssign(-1)
    const v = velocity.sample(vUv).xy
    return vec4(clamp(v.add(force.mul(dt)), -1000, 1000), 0, 1)
  })
  return { pass, strength, dt }
}

const makePressure = (pTex: THREE.Texture, divTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const p = texture(pTex)
  const div = texture(divTex)
  const tx = uniform(txv)
  const pass = new Pass(() => {
    const n = nbrs(p, vUv, tx)
    const d = div.sample(vUv).x
    return vec4(n.l.x.add(n.r.x).add(n.b.x).add(n.t.x).sub(d).mul(0.25), 0, 0, 1)
  })
  return { pass }
}

const makeClear = (srcTex: THREE.Texture) => {
  const vUv = uv()
  const src = texture(srcTex)
  const value = uniform(0.8)
  const pass = new Pass(() => src.sample(vUv).mul(value))
  return { pass, value }
}

const makeGradient = (pTex: THREE.Texture, velocityTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const p = texture(pTex)
  const velocity = texture(velocityTex)
  const tx = uniform(txv)
  const pass = new Pass(() => {
    const n = nbrs(p, vUv, tx)
    const v = velocity.sample(vUv).xy.sub(vec2(n.r.x.sub(n.l.x), n.t.x.sub(n.b.x)))
    return vec4(v, 0, 1)
  })
  return { pass }
}

const makeDisplay = (dyeTex: THREE.Texture, txv: THREE.Vector2) => {
  const vUv = uv()
  const dye = texture(dyeTex)
  const tx = uniform(txv)
  const shading = uniform(1)
  const brightness = uniform(1)
  const bg = uniform(new THREE.Vector3())
  const pass = new Pass(() => {
    const n = nbrs(dye, vUv, tx)
    const dx = length(n.r.xyz).sub(length(n.l.xyz))
    const dy = length(n.t.xyz).sub(length(n.b.xyz))
    const nrm = normalize(vec3(dx, dy, length(tx)))
    const diffuse = clamp(dot(nrm, vec3(0, 0, 1)).add(0.7), 0.7, 1)
    const lit = n.c.xyz.mul(select(shading.greaterThan(0.5), diffuse, float(1)))
    const col = clamp(lit.mul(brightness), 0, 1)
    // Dye covers the background where it is dense.
    const cover = clamp(max(col.x, max(col.y, col.z)), 0, 1)
    const out = col.add(bg.mul(float(1).sub(cover)))
    // Display-space -> linear, so the renderer's sRGB encode restores it.
    return vec4(pow(max(out, vec3(0)), vec3(2.2)), 1)
  })
  return { pass, shading, brightness, bg }
}

interface Brush {
  x: number
  y: number
  angle: number
  phase: number
  color: Color3
  colorAge: number
}

class FluidSim implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly simRes: number
  private readonly dyeRes: number
  private velocity!: Double
  private dye!: Double
  private pressure!: Double
  private divergence!: THREE.RenderTarget
  private curl!: THREE.RenderTarget
  private readonly simTexel = new THREE.Vector2(1, 1)
  private readonly dyeTexel = new THREE.Vector2(1, 1)
  private aspect = 1
  private readonly passes = new Map<string, { pass: Pass }>()

  private time = 0
  private emitAcc = 0
  private colorPhase = 0
  private prevOnset = 0
  private brushes: Brush[] = []
  private latest: ParamValues
  private readonly pointers = new Map<
    number,
    { x: number; y: number; color: Color3; moved: boolean; dx: number; dy: number }
  >()

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    this.simRes = Math.round(num(Number(ctx.params.simResolution), 128))
    this.dyeRes = Math.round(num(Number(ctx.params.dyeResolution), 512))
    this.latest = ctx.params
    this.build(ctx.width, ctx.height)
  }

  /** The pass for a stage reading these exact textures, created on first use. */
  private pass<T extends { pass: Pass }>(
    kind: string,
    textures: readonly THREE.Texture[],
    make: () => T,
  ): T {
    const key = `${kind}:${textures.map((t) => t.uuid).join(',')}`
    let p = this.passes.get(key)
    if (!p) {
      p = make()
      this.passes.set(key, p)
    }
    return p as T
  }

  private build(width: number, height: number) {
    this.aspect = width / Math.max(1, height)
    const [sw, sh] = gridSize(this.simRes, this.aspect)
    const [dw, dh] = gridSize(this.dyeRes, this.aspect)
    this.velocity = new Double(sw, sh)
    this.pressure = new Double(sw, sh)
    this.dye = new Double(dw, dh)
    this.divergence = makeTarget(sw, sh)
    this.curl = makeTarget(sw, sh)
    this.simTexel.set(1 / sw, 1 / sh)
    this.dyeTexel.set(1 / dw, 1 / dh)
    this.clearAll()
  }

  private disposeResources() {
    this.velocity.dispose()
    this.pressure.dispose()
    this.dye.dispose()
    this.divergence.dispose()
    this.curl.dispose()
    for (const { pass } of this.passes.values()) pass.dispose()
    this.passes.clear()
  }

  async compile() {
    // Run every stage once in both ping-pong orientations (the pressure loop
    // flips its parity), so the pipelines exist before the first visible frame.
    const warm = { ...this.latest, pressureIterations: 1 }
    this.step(warm, 1 / 60)
    this.step({ ...warm, pressureIterations: 2 }, 1 / 60)
    this.splat(0.5, 0.5, 0, 0, { r: 0, g: 0, b: 0 })
    this.splat(0.5, 0.5, 0, 0, { r: 0, g: 0, b: 0 })
    this.drawDisplay(this.latest)
    this.renderer.setRenderTarget(null)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    await Promise.all([...this.passes.values()].map((x) => x.pass.compile(this.renderer, camera)))
    this.clearAll()
  }

  private clearAll() {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const clearColor = new THREE.Color()
    const clearVec = clearColor as unknown as Parameters<typeof r.getClearColor>[0]
    r.getClearColor(clearVec)
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 1)
    for (const t of [
      this.velocity.read,
      this.velocity.write,
      this.pressure.read,
      this.pressure.write,
      this.dye.read,
      this.dye.write,
      this.divergence,
      this.curl,
    ]) {
      r.setRenderTarget(t)
      r.clear()
    }
    r.setClearColor(clearColor, alpha)
    r.setRenderTarget(prev)
  }

  resize(width: number, height: number) {
    const aspect = width / Math.max(1, height)
    // Same aspect: the grid already fits. Otherwise rebuild (clears the fluid).
    if (Math.abs(aspect - this.aspect) < 0.02) return
    this.disposeResources()
    this.build(width, height)
  }

  action(key: string) {
    if (key === 'clearFluid') this.clearAll()
    else if (key === 'splatNow')
      this.multipleSplats(Math.max(3, Math.round(num(this.latest.onsetSplats, 5))))
  }

  pointer(e: ScenePointerEvent) {
    const w = Math.max(1, this.canvas.clientWidth)
    const h = Math.max(1, this.canvas.clientHeight)
    if (e.type === 'down') {
      this.pointers.set(e.id, {
        x: e.x / w,
        y: 1 - e.y / h,
        color: this.pickColor(),
        moved: false,
        dx: 0,
        dy: 0,
      })
    } else if (e.type === 'move') {
      const p = this.pointers.get(e.id)
      if (!p) return
      const nx = e.x / w
      const ny = 1 - e.y / h
      p.dx = (nx - p.x) * (this.aspect < 1 ? 1 : this.aspect)
      p.dy = (ny - p.y) * (this.aspect > 1 ? 1 : 1 / this.aspect)
      p.x = nx
      p.y = ny
      p.moved = p.moved || Math.abs(p.dx) > 0 || Math.abs(p.dy) > 0
    } else {
      this.pointers.delete(e.id)
    }
  }

  /** A fresh splat colour from the current colour params, at dye strength. */
  private pickColor(): Color3 {
    const p = this.latest
    let rgb: [number, number, number]
    if (p.colorMode === 'palette') {
      const a = hexToRgb(String(p.colorA ?? '#ff2e93'))
      const b = hexToRgb(String(p.colorB ?? '#2ee6ff'))
      const k = Math.random()
      rgb = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
    } else {
      const spread = num(p.hueSpread, 1)
      const hue = num(p.hueShift, 0) + this.colorPhase + (Math.random() - 0.5) * spread
      rgb = hsvToRgb(hue - Math.floor(hue), 1, 1)
    }
    return { r: rgb[0] * 0.15, g: rgb[1] * 0.15, b: rgb[2] * 0.15 }
  }

  private splat(x: number, y: number, dx: number, dy: number, color: Color3) {
    const r = this.renderer
    let radius = num(this.latest.splatRadius, 0.25) / 100
    if (this.aspect > 1) radius *= this.aspect

    const apply = (field: Double, cx: number, cy: number, cz: number) => {
      const s = this.pass('splat', [field.read.texture], () => makeSplat(field.read.texture))
      s.radius.value = radius
      s.aspect.value = this.aspect
      s.point.value.set(x, y)
      s.color.value.set(cx, cy, cz)
      s.pass.render(r, field.write)
      field.swap()
    }
    apply(this.velocity, dx, dy, 0)
    apply(this.dye, color.r, color.g, color.b)
  }

  private multipleSplats(count: number, strength = 1) {
    const force = num(this.latest.splatForce, 6000) / 6000
    for (let i = 0; i < count; i++) {
      const c = this.pickColor()
      const k = 10 * strength
      this.splat(
        Math.random(),
        Math.random(),
        1000 * force * (Math.random() - 0.5) * strength,
        1000 * force * (Math.random() - 0.5) * strength,
        { r: c.r * k, g: c.g * k, b: c.b * k },
      )
    }
  }

  private applyInputs(frame: SceneFrame, dt: number) {
    const p = frame.params
    const force = num(p.splatForce, 6000)

    for (const ptr of this.pointers.values()) {
      if (!ptr.moved) continue
      ptr.moved = false
      this.splat(ptr.x, ptr.y, ptr.dx * force, ptr.dy * force, ptr.color)
    }

    this.runBrushes(frame, dt)

    // Burst on every attack (rising edge), scaled by how hard it was.
    const onset = frame.audio.onset
    if (onset > 0.5 && this.prevOnset <= 0.5) {
      const n = Math.round(num(p.onsetSplats, 5))
      if (n > 0) this.multipleSplats(n, 0.5 + frame.audio.volume)
    }
    this.prevOnset = onset

    this.emitAcc += dt * Math.max(0, num(p.emitRate, 0))
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1
      this.multipleSplats(1, 0.4 + frame.audio.volume * 0.6)
    }
  }

  /**
   * Audio brushes: virtual pointers that sweep through the fluid while there
   * is signal, exactly like a dragged mouse. Level (volume, with sustain
   * building it up) drives push and dye, so playing harder paints stronger.
   */
  private runBrushes(frame: SceneFrame, dt: number) {
    const p = frame.params
    const count = Math.max(0, Math.min(8, Math.round(num(p.brushCount, 2))))
    while (this.brushes.length > count) this.brushes.pop()
    while (this.brushes.length < count) {
      this.brushes.push({
        x: Math.random(),
        y: Math.random(),
        angle: Math.random() * Math.PI * 2,
        phase: Math.random() * 100,
        color: this.pickColor(),
        colorAge: 0,
      })
    }
    const level = Math.min(1, Math.max(frame.audio.volume, frame.audio.sustain * 0.8))
    if (count === 0 || level < 0.02) return
    const gain = num(p.brushIntensity, 1) * (0.25 + 1.75 * level)
    const force = num(p.splatForce, 6000)
    const speed = num(p.brushSpeed, 0.5) * (0.3 + level)
    const wander = num(p.brushWander, 0.5)

    for (const b of this.brushes) {
      b.phase += dt
      // Smooth, non-repeating steering from two slow sines.
      b.angle += (Math.sin(b.phase * 1.3) + Math.sin(b.phase * 0.7 + 2)) * wander * 2.5 * dt
      let dx = Math.cos(b.angle) * speed * dt
      let dy = Math.sin(b.angle) * speed * dt
      let nx = b.x + dx
      let ny = b.y + dy
      // Bounce off the walls.
      if (nx < 0 || nx > 1) {
        b.angle = Math.PI - b.angle
        nx = Math.min(1, Math.max(0, nx))
        dx = -dx
      }
      if (ny < 0 || ny > 1) {
        b.angle = -b.angle
        ny = Math.min(1, Math.max(0, ny))
        dy = -dy
      }
      b.x = nx
      b.y = ny
      b.colorAge += dt
      if (b.colorAge > 0.6) {
        b.color = this.pickColor()
        b.colorAge = 0
      }
      const c = { r: b.color.r * gain, g: b.color.g * gain, b: b.color.b * gain }
      const ax = this.aspect < 1 ? 1 : this.aspect
      const ay = this.aspect > 1 ? 1 : 1 / this.aspect
      this.splat(b.x, b.y, dx * ax * force * gain, dy * ay * force * gain, c)
    }
  }

  private step(p: Readonly<ParamValues>, dt: number) {
    const r = this.renderer
    const tx = this.simTexel
    const vel = () => this.velocity.read.texture

    const curl = this.pass('curl', [vel()], () => makeCurl(vel(), tx))
    curl.pass.render(r, this.curl)

    const vort = this.pass('vort', [vel(), this.curl.texture], () =>
      makeVorticity(vel(), this.curl.texture, tx),
    )
    vort.strength.value = num(p.curl, 30)
    vort.dt.value = dt
    vort.pass.render(r, this.velocity.write)
    this.velocity.swap()

    const div = this.pass('div', [vel()], () => makeDivergence(vel(), tx))
    div.pass.render(r, this.divergence)

    const clear = this.pass('clear', [this.pressure.read.texture], () =>
      makeClear(this.pressure.read.texture),
    )
    clear.value.value = THREE.MathUtils.clamp(num(p.pressure, 0.8), 0, 1)
    clear.pass.render(r, this.pressure.write)
    this.pressure.swap()

    const iterations = Math.max(1, Math.round(num(p.pressureIterations, 20)))
    for (let i = 0; i < iterations; i++) {
      const pr = this.pass('pressure', [this.pressure.read.texture, this.divergence.texture], () =>
        makePressure(this.pressure.read.texture, this.divergence.texture, tx),
      )
      pr.pass.render(r, this.pressure.write)
      this.pressure.swap()
    }

    const grad = this.pass('grad', [this.pressure.read.texture, vel()], () =>
      makeGradient(this.pressure.read.texture, vel(), tx),
    )
    grad.pass.render(r, this.velocity.write)
    this.velocity.swap()

    const advectVel = this.pass('advV', [vel()], () => makeAdvect(vel(), vel(), tx))
    advectVel.dt.value = dt
    advectVel.dissipation.value = num(p.velocityDissipation, 0.2)
    advectVel.pass.render(r, this.velocity.write)
    this.velocity.swap()

    const advectDye = this.pass('advD', [vel(), this.dye.read.texture], () =>
      makeAdvect(vel(), this.dye.read.texture, tx),
    )
    advectDye.dt.value = dt
    advectDye.dissipation.value = num(p.densityDissipation, 1)
    advectDye.pass.render(r, this.dye.write)
    this.dye.swap()
  }

  private drawDisplay(p: Readonly<ParamValues>) {
    const d = this.pass('display', [this.dye.read.texture], () =>
      makeDisplay(this.dye.read.texture, this.dyeTexel),
    )
    d.shading.value = p.shading === false ? 0 : 1
    d.brightness.value = num(p.brightness, 1)
    const [br, bg, bb] = hexToRgb(String(p.backgroundColor ?? '#000000'))
    d.bg.value.set(br, bg, bb)
    d.pass.render(this.renderer, null)
  }

  update(frame: SceneFrame) {
    const p = frame.params
    this.latest = p
    const sim = p.paused === true ? 0 : frame.dt * num(p.timeScale, 1)
    this.time += sim
    this.colorPhase += sim * num(p.colorSpeed, 0.02)

    if (sim > 0) {
      this.applyInputs(frame, sim)
      this.step(p, Math.min(sim, 1 / 60))
    }
    this.drawDisplay(p)
  }

  dispose() {
    this.disposeResources()
    this.renderer.setRenderTarget(null)
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new FluidSim(ctx)
  await scene.compile()
  return scene
}
