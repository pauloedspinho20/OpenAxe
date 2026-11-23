/**
 * Holographic Cube Grid - TSL port of Sabo Sugi's GLSL ray marcher (see
 * ./definition.ts for credit). Structure follows the original shader:
 *
 *   env  ->  SDF grid (pulsing rounded cubes per cell)  ->  march + glow  ->
 *   normals / AO  ->  interior march + dispersive refraction  ->
 *   display-space composite over the background  ->  scanlines
 *
 * Porting notes:
 * - Leaf functions use `Fn().setLayout()` so they compile to real WGSL/GLSL
 *   functions. GLSL `out` params become packed returns: map() returns
 *   vec3(dist, glowDist, cellId), traceInterior() returns vec4(pExit, t).
 * - mapNear()'s 8-neighbour loop with bit ops is unrolled in JS.
 * - The original composites in display space (own ACES + pow(1/2.2)); that
 *   result is linearised with pow(2.2) at the end so the renderer's sRGB
 *   encode lands the same colour on screen.
 * - SMAA is dropped (supersampling remains as the `aa` rebuild param); DPR
 *   belongs to the host.
 * - MAX_STEPS / INTERIOR_STEPS / AO_SAMPLES / AA stay compile-time constants
 *   (`rebuild` params).
 */
import * as THREE from 'three/webgpu'
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  bool,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  inverseSqrt,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  pow,
  reflect,
  refract,
  screenCoordinate,
  screenSize,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
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

const TAU = Math.PI * 2
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const DRAG_RESPONSE = 18

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** '#rrggbb' -> display-space RGB 0..1 (no colour management, like the original). */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function buildMaterial(MAX_STEPS: number, INTERIOR_STEPS: number, AO_SAMPLES: number, AA: number) {
  const u = {
    camPos: uniform(new THREE.Vector3()),
    camRight: uniform(new THREE.Vector3()),
    camUp: uniform(new THREE.Vector3()),
    camForward: uniform(new THREE.Vector3()),
    focal: uniform(1),
    objRot: uniform(new THREE.Matrix3()),
    pulse: uniform(0),
    cell: uniform(1),
    gridHalf: uniform(3),
    gridOff: uniform(0),
    boundRadius: uniform(2),
    cubeMin: uniform(0.09),
    cubeMax: uniform(0.57),
    cubeRound: uniform(0.21),
    pulseFreq: uniform(2),
    maxDist: uniform(16.48),
    surfEps: uniform(0.0006),
    stepFactor: uniform(0.85),
    holoFreq: uniform(1.4),
    holoPhase: uniform(0),
    holoAmount: uniform(0.35),
    sweepY: uniform(-2.5),
    sweepGlow: uniform(0.6),
    scanlines: uniform(0.08),
    glowStrength: uniform(0.63),
    exposure: uniform(2),
    glassIor: uniform(1.25),
    dispersion: uniform(0.097),
    absorb: uniform(new THREE.Vector3(3.6, 1.4, 0.9)),
    bg: uniform(new THREE.Vector3()),
    hueShift: uniform(0),
  }

  // ---------- Math ----------
  const sphereIntersect = Fn(([ro, rd, r]: N[]) => {
    const b = dot(ro, rd)
    const c = dot(ro, ro).sub(r.mul(r))
    const h = b.mul(b).sub(c).toVar()
    const res = vec2(-1).toVar()
    If(h.greaterThanEqual(0), () => {
      const s = sqrt(h)
      res.assign(vec2(b.negate().sub(s), b.negate().add(s)))
    })
    return res
  }).setLayout({
    name: 'sphereIntersect',
    type: 'vec2',
    inputs: [
      { name: 'ro', type: 'vec3' },
      { name: 'rd', type: 'vec3' },
      { name: 'r', type: 'float' },
    ],
  })

  const safeRefract = Fn(([I, Nn, eta]: N[]) => {
    const r = refract(I, Nn, eta).toVar()
    return select(dot(r, r).lessThan(1e-6), reflect(I, Nn), r)
  }).setLayout({
    name: 'safeRefract',
    type: 'vec3',
    inputs: [
      { name: 'I', type: 'vec3' },
      { name: 'Nn', type: 'vec3' },
      { name: 'eta', type: 'float' },
    ],
  })

  // ---------- Color ----------
  const holoPalette = Fn(([x]: N[]) => {
    const c = cos(
      x
        .add(u.hueShift)
        .add(vec3(0.0, 0.33, 0.67))
        .mul(TAU),
    )
      .mul(0.5)
      .add(0.5)
      .toVar()
    c.assign(mix(c, c.mul(vec3(0.75, 0.9, 1.15)), 0.5))
    return c.mul(c)
  }).setLayout({ name: 'holoPalette', type: 'vec3', inputs: [{ name: 'x', type: 'float' }] })

  const thinFilm = Fn(([ndv, thickness]: N[]) => {
    const sinT2 = float(1)
      .sub(ndv.mul(ndv))
      .div(1.4 * 1.4)
    const cosT = sqrt(max(float(1).sub(sinT2), 0.0))
    const phase = thickness.mul(cosT).mul(u.holoFreq).add(u.hueShift)
    const c = cos(phase.add(vec3(0.0, 0.33, 0.67)).mul(TAU))
      .mul(0.5)
      .add(0.5)
      .toVar()
    c.assign(mix(c, c.mul(vec3(0.8, 0.95, 1.2)), 0.4))
    return c.mul(c).mul(2.0).add(0.15)
  }).setLayout({
    name: 'thinFilm',
    type: 'vec3',
    inputs: [
      { name: 'ndv', type: 'float' },
      { name: 'thickness', type: 'float' },
    ],
  })

  const aces = (x: N) =>
    clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1)

  // Linear HDR -> display (exposure, ACES, gamma)
  const toDisplay = Fn(([c]: N[]) =>
    pow(aces(max(c.mul(u.exposure), vec3(0))), vec3(1 / 2.2)),
  ).setLayout({ name: 'toDisplay', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] })

  // ---------- Environment ----------
  const envBase = (d: N) =>
    mix(vec3(0.004, 0.005, 0.012), vec3(0.012, 0.008, 0.03), clamp(d.y.mul(0.5).add(0.5), 0, 1))

  const envLit = Fn(([d]: N[]) => {
    const c = envBase(d).mul(2.0).toVar()
    c.addAssign(
      vec3(1.0, 0.96, 0.92)
        .mul(3.0)
        .mul(float(1).sub(smoothstep(0.05, 0.25, abs(d.x))))
        .mul(smoothstep(0.55, 0.8, d.y)),
    )
    c.addAssign(
      vec3(0.35, 0.7, 1.3)
        .mul(2.0)
        .mul(smoothstep(0.78, 0.96, dot(d, vec3(-0.94, 0.19, 0.28)))),
    )
    c.addAssign(
      vec3(1.2, 0.45, 0.95)
        .mul(1.6)
        .mul(smoothstep(0.8, 0.97, dot(d, vec3(0.93, -0.28, -0.19)))),
    )
    c.addAssign(vec3(0.05, 0.06, 0.1).mul(float(1).sub(smoothstep(-0.8, 0.0, d.y))))
    return c
  }).setLayout({ name: 'envLit', type: 'vec3', inputs: [{ name: 'd', type: 'vec3' }] })

  // ---------- SDF ----------
  const sdBox = Fn(([p, b]: N[]) => {
    const q = abs(p).sub(b).toVar()
    return length(max(q, vec3(0))).add(min(max(q.x, max(q.y, q.z)), 0.0))
  }).setLayout({
    name: 'sdBox',
    type: 'float',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 'b', type: 'vec3' },
    ],
  })

  // Rounded pulsing cube inside one cell (cell units)
  const cubeDist = Fn(([r, id]: N[]) => {
    const k = float(0.5).sub(sin(u.pulseFreq.mul(length(id)).add(u.pulse)).mul(0.5))
    const h = mix(u.cubeMin, u.cubeMax, k)
    const rr = min(u.cubeRound, h.mul(0.5))
    return sdBox(r, vec3(h.sub(rr))).sub(rr)
  }).setLayout({
    name: 'cubeDist',
    type: 'float',
    inputs: [
      { name: 'r', type: 'vec3' },
      { name: 'id', type: 'vec3' },
    ],
  })

  // Marching distance -> vec3(dist, glowDist, cellId)
  const mapFull = Fn(([p]: N[]) => {
    const q = u.objRot.mul(p).div(u.cell).toVar()
    const id = floor(q.sub(u.gridOff).add(0.5)).add(u.gridOff).toVar()
    const r = q.sub(id).toVar()
    const dCube = cubeDist(r, id).toVar()
    const ar = abs(r)
    const dCell = float(0.5)
      .sub(max(ar.x, max(ar.y, ar.z)))
      .add(0.03)
    const dBox = sdBox(q, vec3(u.gridHalf.add(0.5))).toVar()
    return vec3(max(min(dCube, dCell), dBox).mul(u.cell), max(dCube, dBox).mul(u.cell), length(id))
  }).setLayout({ name: 'mapFull', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] })

  const mapD = Fn(([p]: N[]) => mapFull(p).x).setLayout({
    name: 'mapD',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec3' }],
  })

  // Neighbour-aware distance (8 nearest cells), used for AO only
  const mapNear = Fn(([p]: N[]) => {
    const q = u.objRot.mul(p).div(u.cell).toVar()
    const base = floor(q.sub(u.gridOff)).add(u.gridOff).toVar()
    const d = float(1e9).toVar()
    for (let i = 0; i < 8; i++) {
      const o = vec3(i & 1, (i >> 1) & 1, i >> 2)
      const id = clamp(base.add(o), u.gridHalf.negate(), u.gridHalf).toVar()
      d.assign(min(d, cubeDist(q.sub(id), id)))
    }
    return d.mul(u.cell)
  }).setLayout({ name: 'mapNear', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] })

  // ---------- Normals & AO ----------
  const calcNormal = Fn(([p, h]: N[]) => {
    const kxyy = vec3(1, -1, -1)
    const kyyx = vec3(-1, -1, 1)
    const kyxy = vec3(-1, 1, -1)
    const kxxx = vec3(1, 1, 1)
    const g = kxyy
      .mul(mapD(p.add(kxyy.mul(h))))
      .add(kyyx.mul(mapD(p.add(kyyx.mul(h)))))
      .add(kyxy.mul(mapD(p.add(kyxy.mul(h)))))
      .add(kxxx.mul(mapD(p.add(kxxx.mul(h)))))
      .toVar()
    return g.mul(inverseSqrt(max(dot(g, g), 1e-12)))
  }).setLayout({
    name: 'calcNormal',
    type: 'vec3',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 'h', type: 'float' },
    ],
  })

  const calcAO = Fn(([p, n]: N[]) => {
    const occ = float(0).toVar()
    const w = float(1).toVar()
    Loop(AO_SAMPLES, ({ i }: N) => {
      const h = float(i).mul(0.06).add(0.01)
      occ.addAssign(h.sub(mapNear(p.add(n.mul(h)))).mul(w))
      w.mulAssign(0.7)
    })
    return clamp(float(1).sub(occ.mul(3.0)), 0, 1)
  }).setLayout({
    name: 'calcAO',
    type: 'float',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 'n', type: 'vec3' },
    ],
  })

  // ---------- Interior march -> vec4(pExit, t) ----------
  const traceInterior = Fn(([ro, rd]: N[]) => {
    const t = float(0).toVar()
    Loop(INTERIOR_STEPS, () => {
      const d = mapD(ro.add(rd.mul(t)))
        .negate()
        .toVar()
      If(d.lessThan(0.001), () => {
        Break()
      })
      t.addAssign(max(d.mul(u.stepFactor), 0.004))
      If(t.greaterThan(u.boundRadius.mul(2.0)), () => {
        Break()
      })
    })
    return vec4(ro.add(rd.mul(t)), t)
  }).setLayout({
    name: 'traceInterior',
    type: 'vec4',
    inputs: [
      { name: 'ro', type: 'vec3' },
      { name: 'rd', type: 'vec3' },
    ],
  })

  const LIGHT = vec3(0.5306, 0.796, -0.2908)

  // ---------- Render one sample (inline) ----------
  const render = (fragCoord: N): N => {
    const res = screenSize
    const uv = fragCoord.mul(2).sub(res).div(res.y).toVar()
    const ro = vec3(u.camPos).toVar()
    const rd = normalize(
      u.camRight.mul(uv.x).add(u.camUp.mul(uv.y)).add(u.camForward.mul(u.focal)),
    ).toVar()

    const objCol = vec3(0).toVar()
    const coverage = float(0).toVar()

    const bnd = sphereIntersect(ro, rd, u.boundRadius).toVar()
    const t = max(bnd.x, 0.0).toVar()
    const tFar = min(bnd.y, t.add(u.maxDist)).toVar()
    const glow = float(0).toVar()
    const cellId = float(0).toVar()
    const hit = bool(false).toVar()

    If(bnd.y.greaterThan(0), () => {
      Loop(MAX_STEPS, () => {
        const m = mapFull(ro.add(rd.mul(t))).toVar()
        cellId.assign(m.z)
        glow.addAssign(exp(m.y.mul(-30.0)).mul(0.012))
        If(m.x.lessThan(u.surfEps.mul(t)), () => {
          hit.assign(bool(true))
          Break()
        })
        t.addAssign(m.x.mul(u.stepFactor))
        If(t.greaterThan(tFar), () => {
          Break()
        })
      })
    })

    If(hit, () => {
      const p = ro.add(rd.mul(t)).toVar()
      const n = calcNormal(p, max(u.surfEps.mul(t), 0.0005)).toVar()
      const ao = calcAO(p, n).toVar()
      const ndv = clamp(dot(n, rd.negate()), 0, 1).toVar()
      const fr = float(1).sub(ndv)
      const fr2 = fr.mul(fr)
      const F = float(0.04).add(fr2.mul(fr2).mul(fr).mul(0.96)).toVar()

      const filmThick = float(1)
        .add(cellId.mul(0.25))
        .add(sin(dot(p, vec3(2.1, 1.7, 2.6))).mul(0.4))
        .add(u.holoPhase.div(u.holoFreq))
      const film = thinFilm(ndv, filmThick).toVar()
      const reflTint = mix(vec3(1.0), film, u.holoAmount).toVar()
      const refl = envLit(reflect(rd, n)).mul(reflTint).toVar()

      const dIn = safeRefract(rd, n, float(1).div(u.glassIor)).toVar()
      const inner = traceInterior(p.sub(n.mul(0.01)), dIn).toVar()
      const pExit = inner.xyz
      const thick = inner.w
      const nExit = calcNormal(pExit, 0.001).negate().toVar()
      const trans = vec3(
        envLit(safeRefract(dIn, nExit, u.glassIor.sub(u.dispersion))).x,
        envLit(safeRefract(dIn, nExit, u.glassIor)).y,
        envLit(safeRefract(dIn, nExit, u.glassIor.add(u.dispersion))).z,
      )
        .mul(exp(u.absorb.mul(thick).negate()))
        .toVar()

      const dif = clamp(dot(n, LIGHT), 0, 1)
      const hv = normalize(LIGHT.sub(rd))
      const spec = pow(clamp(dot(n, hv), 0, 1), 96.0)

      const aoSoft = mix(0.55, 1.0, ao)
      objCol.assign(mix(trans, refl, F).mul(aoSoft))
      objCol.addAssign(film.mul(u.holoAmount).mul(0.08).mul(dif.add(0.3)).mul(ao))
      objCol.addAssign(reflTint.mul(spec).mul(2.5).mul(ao))

      const sy = p.y.sub(u.sweepY)
      objCol.addAssign(film.mul(exp(sy.mul(sy).mul(-60.0))).mul(u.sweepGlow))

      // Depth fog -> fades toward the background colour
      const depth = max(t.sub(length(ro).sub(u.boundRadius)), 0.0)
      coverage.assign(exp(depth.mul(depth).mul(-0.08)))
    })

    // Volumetric edge glow (linear HDR)
    const glowLin = holoPalette(uv.y.mul(0.25).add(0.6).add(u.holoPhase))
      .mul(glow)
      .mul(u.glowStrength)
      .toVar()

    // Composite in display space so the background colour stays exactly as picked
    const bgWithGlow = float(1).sub(
      float(1)
        .sub(u.bg)
        .mul(float(1).sub(toDisplay(glowLin))),
    )
    const col = mix(bgWithGlow, toDisplay(objCol.add(glowLin)), coverage).toVar()

    // Scanlines
    col.mulAssign(
      float(1).sub(
        u.scanlines.mul(
          sin(fragCoord.y.mul(TAU / 3))
            .mul(0.5)
            .add(0.5),
        ),
      ),
    )
    return col
  }

  const fragment = Fn(() => {
    // TSL's screenCoordinate is top-left on both backends; the original is GL bottom-left.
    const fc = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y)).toVar()
    const col = vec3(0).toVar()
    Loop(AA, AA, ({ i, j }: N) => {
      col.addAssign(render(fc.add(vec2(float(i), float(j)).add(0.5).div(AA).sub(0.5))))
    })
    col.divAssign(AA * AA)
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

class HoloGrid implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh: THREE.Mesh
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicNodeMaterial
  private readonly u: ReturnType<typeof buildMaterial>['u']

  private readonly anim = { rotPhase: 0, pulsePhase: 0, holoPhase: 0, sweepPhase: 0 }
  private kickVel = 0
  private readonly pointerState = { dragging: false, id: -1, lastX: 0, lastY: 0, accX: 0, accY: 0 }
  private readonly spin = { velX: 0, velY: 0 }
  private readonly userQuat = new THREE.Quaternion()
  private readonly tmpQuat = new THREE.Quaternion()
  private readonly rotY = new THREE.Matrix3()
  private readonly rotX = new THREE.Matrix3()
  private readonly autoRot = new THREE.Matrix3()
  private readonly userRotT = new THREE.Matrix3()
  private readonly userMat4 = new THREE.Matrix4()
  private readonly camRight = new THREE.Vector3()
  private readonly camUp = new THREE.Vector3()

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    const p = ctx.params
    const built = buildMaterial(
      Math.round(num(p.maxSteps, 120)),
      Math.round(num(p.interiorSteps, 40)),
      Math.round(num(p.aoSamples, 5)),
      Math.round(num(p.aa, 1)),
    )
    this.material = built.material
    this.u = built.u
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  async compile() {
    await this.renderer.compileAsync(this.scene, this.camera)
  }

  resize() {
    // screenSize is read from the renderer each frame; nothing to do.
  }

  action(key: string) {
    if (key === 'resetRotation') {
      this.userQuat.identity()
      this.spin.velX = 0
      this.spin.velY = 0
    } else if (key === 'resetTime') {
      this.anim.rotPhase = 0
      this.anim.pulsePhase = 0
      this.anim.holoPhase = 0
      this.anim.sweepPhase = 0
      this.kickVel = 0
    }
  }

  pointer(ev: ScenePointerEvent) {
    const ps = this.pointerState
    if (ev.type === 'down') {
      if (ps.dragging) return
      ps.dragging = true
      ps.id = ev.id
      ps.lastX = ev.x
      ps.lastY = ev.y
      ps.accX = 0
      ps.accY = 0
    } else if (ev.id === ps.id && ps.dragging) {
      if (ev.type === 'move') {
        ps.accX += ev.x - ps.lastX
        ps.accY += ev.y - ps.lastY
        ps.lastX = ev.x
        ps.lastY = ev.y
      } else {
        ps.dragging = false
        ps.id = -1
      }
    }
  }

  private updateCamera(p: Readonly<ParamValues>) {
    const u = this.u
    const camPos = u.camPos.value as THREE.Vector3
    const camForward = u.camForward.value as THREE.Vector3
    camPos.set(0, num(p.camHeight, -5.18), -num(p.camDistance, 5.86))
    camForward.copy(camPos).negate().normalize()
    this.camRight.crossVectors(WORLD_UP, camForward).normalize()
    this.camUp.crossVectors(camForward, this.camRight)
    ;(u.camRight.value as THREE.Vector3).copy(this.camRight)
    ;(u.camUp.value as THREE.Vector3).copy(this.camUp)
    u.focal.value = 1 / Math.tan(THREE.MathUtils.degToRad(num(p.fov, 42)) * 0.5)
  }

  private updateUserRotation(dt: number, p: Readonly<ParamValues>) {
    const ps = this.pointerState
    const spin = this.spin
    if (ps.dragging) {
      const sens = (num(p.dragSensitivity, 1) * 3) / Math.max(this.canvas.clientHeight, 1)
      const targetX = (ps.accX * sens) / dt
      const targetY = (ps.accY * sens) / dt
      ps.accX = 0
      ps.accY = 0
      const k = 1 - Math.exp(-DRAG_RESPONSE * dt)
      spin.velX += (targetX - spin.velX) * k
      spin.velY += (targetY - spin.velY) * k
    } else {
      const decay = Math.exp(-num(p.inertiaDamping, 2.5) * dt)
      spin.velX *= decay
      spin.velY *= decay
    }
    const angX = -spin.velX * dt
    const angY = -spin.velY * dt
    if (Math.abs(angX) + Math.abs(angY) < 1e-7) return
    this.tmpQuat.setFromAxisAngle(this.camUp, angX)
    this.userQuat.premultiply(this.tmpQuat)
    this.tmpQuat.setFromAxisAngle(this.camRight, angY)
    this.userQuat.premultiply(this.tmpQuat)
    this.userQuat.normalize()
  }

  private updateAnimation(dt: number, p: Readonly<ParamValues>) {
    const t = p.paused === true ? 0 : dt * num(p.timeScale, 1)
    const anim = this.anim
    const rot = num(p.rotSpeed, 0.22)
    // Spin kick pushes along the current rotation direction and coasts down with inertia damping.
    this.kickVel += num(p.spinKick, 0) * 3 * t * (rot < 0 ? -1 : 1)
    this.kickVel *= Math.exp(-num(p.inertiaDamping, 2.5) * dt)
    anim.rotPhase += t * rot + this.kickVel * t
    // Pulse kick advances the pulse wave while it is raised (an impulse = a jump forward).
    anim.pulsePhase += t * (num(p.pulseSpeed, 2) + num(p.pulseKick, 0) * 6)
    anim.holoPhase += t * num(p.holoSpeed, 0.08)
    anim.sweepPhase += t * num(p.sweepSpeed, 0.55)

    // Auto rotation: rotYX(ay, ax), identical to the GLSL version
    const ay = anim.rotPhase
    const ax = 0.35 + 0.2 * Math.sin(anim.rotPhase * 0.7)
    const cy = Math.cos(ay)
    const sy = Math.sin(ay)
    const cx = Math.cos(ax)
    const sx = Math.sin(ax)
    this.rotY.set(cy, 0, sy, 0, 1, 0, -sy, 0, cy)
    this.rotX.set(1, 0, 0, 0, cx, -sx, 0, sx, cx)
    this.autoRot.multiplyMatrices(this.rotY, this.rotX)

    // World -> object: autoRot * transpose(userRotation)
    this.userMat4.makeRotationFromQuaternion(this.userQuat)
    this.userRotT.setFromMatrix4(this.userMat4).transpose()
    ;(this.u.objRot.value as THREE.Matrix3).multiplyMatrices(this.autoRot, this.userRotT)

    this.u.pulse.value = anim.pulsePhase
    this.u.holoPhase.value = anim.holoPhase
    const s = anim.sweepPhase % 5
    this.u.sweepY.value = (s < 0 ? s + 5 : s) - 2.5
  }

  private syncUniforms(p: Readonly<ParamValues>) {
    const u = this.u
    const objectSize = num(p.objectSize, 1.42)
    const n = Math.max(1, Math.round(num(p.gridN, 7)))
    u.cell.value = (2 * objectSize) / n
    u.gridHalf.value = 0.5 * (n - 1)
    u.gridOff.value = 0.5 - 0.5 * (n % 2)
    u.boundRadius.value = objectSize * 1.7320508 + 0.02

    u.cubeMin.value = num(p.cubeMin, 0.09)
    u.cubeMax.value = num(p.cubeMax, 0.57)
    u.cubeRound.value = num(p.cubeRound, 0.21)
    u.pulseFreq.value = num(p.pulseFreq, 2)
    u.maxDist.value = num(p.maxDist, 16.48)
    u.surfEps.value = num(p.surfEps, 0.0006)
    u.stepFactor.value = num(p.stepFactor, 0.85)
    u.holoFreq.value = Math.max(num(p.holoFreq, 1.4), 0.01)
    u.holoAmount.value = num(p.holoAmount, 0.35)
    u.scanlines.value = num(p.scanlines, 0.08)
    u.glowStrength.value = num(p.glowStrength, 0.63)
    u.exposure.value = num(p.exposure, 2)
    u.sweepGlow.value = num(p.sweepGlow, 0.6)
    u.glassIor.value = num(p.glassIor, 1.25)
    u.dispersion.value = num(p.dispersion, 0.097)
    u.hueShift.value = num(p.hueShift, 0)
    ;(u.absorb.value as THREE.Vector3).set(
      num(p.absorbR, 3.6),
      num(p.absorbG, 1.4),
      num(p.absorbB, 0.9),
    )
    const [r, g, b] = hexToRgb(String(p.backgroundColor ?? '#000000'))
    ;(u.bg.value as THREE.Vector3).set(r, g, b)
  }

  update(frame: SceneFrame) {
    const { dt, params: p } = frame
    this.updateCamera(p)
    this.updateUserRotation(dt, p)
    this.updateAnimation(dt, p)
    this.syncUniforms(p)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new HoloGrid(ctx)
  await scene.compile()
  return scene
}
