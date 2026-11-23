/**
 * Distilled Cube - TSL port of Sabo Sugi's GLSL ray tracer (see
 * ./definition.ts for credit). Structure follows the original shader one to
 * one so it can be diffed against it:
 *
 *   studio env  ->  lamination structure (planes + coatings)  ->
 *   traceGlass (internal events + outer-face bounces)  ->  shadeCube  ->
 *   render (camera ray, AA loop)  ->  ACES
 *
 * Porting notes:
 * - Leaf functions use `Fn().setLayout()` so they compile to real WGSL/GLSL
 *   functions instead of being inlined at every call site.
 * - `traceGlass` has GLSL `out` params, which layout functions cannot
 *   express, so it is a JS helper that emits its nodes inline into the
 *   caller (it runs twice per sample, once per split path).
 * - Dynamic vector indexing (`p[ax]`) becomes select()/If chains; the
 *   per-axis loops are unrolled in JS.
 * - The output is linear ACES; the renderer applies the sRGB encode (the
 *   original did pow(1/2.2) itself on a non-colour-managed WebGL canvas).
 * - GRID_N / MAX_EVENTS / BOUNCES / AA stay compile-time constants: changing
 *   them rebuilds the scene (they are `rebuild` params).
 */
import * as THREE from 'three/webgpu'
import {
  Break,
  Continue,
  Fn,
  If,
  Loop,
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  int,
  ivec3,
  max,
  min,
  mix,
  normalize,
  pow,
  radians,
  reflect,
  refract,
  screenCoordinate,
  screenSize,
  select,
  sign,
  sin,
  smoothstep,
  step,
  tan,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
  bool,
  positionGeometry,
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

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0.395, 0.954, 0.954]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Rotates an RGB colour's hue by `turns` (0..1) in HSL, keeping S and L. */
export function rotateHue(
  [r, g, b]: [number, number, number],
  turns: number,
): [number, number, number] {
  if (turns === 0) return [r, g, b]
  const c = new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl, THREE.LinearSRGBColorSpace)
  c.setHSL((((hsl.h + turns) % 1) + 1) % 1, hsl.s, hsl.l, THREE.LinearSRGBColorSpace)
  return [c.r, c.g, c.b]
}

const CUBE_C = new THREE.Vector3(0, 1.7320508, 0)
const CAM_RO = new THREE.Vector3(0, 3.1, 8.4)
const CAM_FW = new THREE.Vector3().subVectors(CUBE_C, CAM_RO).normalize()
const CAM_RT = new THREE.Vector3().crossVectors(CAM_FW, new THREE.Vector3(0, 1, 0)).normalize()
const CAM_UP = new THREE.Vector3().crossVectors(CAM_RT, CAM_FW)

// GLSL mat3 is column-major, Matrix3.fromArray reads column-major too.
const TILT = new THREE.Matrix3().fromArray([
  0.7071068, -0.7071068, 0.0, 0.5773503, 0.5773503, 0.5773503, -0.4082483, -0.4082483, 0.8164966,
])

function buildMaterial(GRID_N: number, MAX_EVENTS: number, BOUNCES: number, AA: number) {
  const GN = int(GRID_N)

  const u = {
    w2l: uniform(new THREE.Matrix3()),
    l2w: uniform(new THREE.Matrix3()),
    time: uniform(0),
    pos: uniformArray(new Array<number>(GRID_N).fill(0), 'float'),
    fov: uniform(34),
    ior: uniform(1.7),
    coating: uniform(0.22),
    mirrorR: uniform(0.6),
    filmR: uniform(1.21),
    filmShift: uniform(0),
    tint: uniform(new THREE.Vector3()),
    reflSoft: uniform(0.35),
    lightSoft: uniform(0.12),
    bevel: uniform(0.012),
    exposure: uniform(1.9),
  }

  // ---------------- Math ----------------
  const maxc = (v: N) => max(v.x, max(v.y, v.z))
  const comp = (v: N, ax: N) => select(ax.equal(int(0)), v.x, select(ax.equal(int(1)), v.y, v.z))
  const setComp = (v: N, ax: N, value: N) => {
    If(ax.equal(int(0)), () => {
      v.x.assign(value)
    })
      .ElseIf(ax.equal(int(1)), () => {
        v.y.assign(value)
      })
      .Else(() => {
        v.z.assign(value)
      })
  }

  const fresnel = Fn(([c]: N[]) =>
    float(0.04).add(float(0.96).mul(pow(float(1).sub(clamp(c, 0, 1)), 5))),
  ).setLayout({ name: 'fresnel', type: 'float', inputs: [{ name: 'c', type: 'float' }] })

  const aces = (x: N) =>
    clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1)

  const hash12 = Fn(([p]: N[]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
    p3.addAssign(dot(p3, p3.yzx.add(33.33)))
    return fract(p3.x.add(p3.y).mul(p3.z))
  }).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

  // ---------------- Intersections ----------------
  const safeInv = Fn(([d]: N[]) => {
    const e = float(1e-6)
    return vec3(
      select(abs(d.x).lessThan(e), e, d.x),
      select(abs(d.y).lessThan(e), e, d.y),
      select(abs(d.z).lessThan(e), e, d.z),
    ).reciprocal()
  }).setLayout({ name: 'safeInv', type: 'vec3', inputs: [{ name: 'd', type: 'vec3' }] })

  const boxT = Fn(([ro, m, r]: N[]) => {
    const n = m.mul(ro)
    const k = abs(m).mul(r)
    const t1 = n.negate().sub(k)
    const t2 = n.negate().add(k)
    return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z))
  }).setLayout({
    name: 'boxT',
    type: 'vec2',
    inputs: [
      { name: 'ro', type: 'vec3' },
      { name: 'm', type: 'vec3' },
      { name: 'r', type: 'float' },
    ],
  })

  const boxNormal = Fn(([p]: N[]) => {
    const a = abs(p)
    const r = vec3(0, 0, sign(p.z)).toVar()
    If(a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z)), () => {
      r.assign(vec3(sign(p.x), 0, 0))
    }).ElseIf(a.y.greaterThanEqual(a.z), () => {
      r.assign(vec3(0, sign(p.y), 0))
    })
    return r
  }).setLayout({ name: 'boxNormal', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] })

  // ---------------- Studio ----------------
  const rect = Fn(([p, h, b]: N[]) => {
    const q = abs(p).sub(h)
    const e = b.add(0.005)
    return float(1).sub(smoothstep(e.negate(), e, max(q.x, q.y)))
  }).setLayout({
    name: 'rect',
    type: 'float',
    inputs: [
      { name: 'p', type: 'vec2' },
      { name: 'h', type: 'vec2' },
      { name: 'b', type: 'float' },
    ],
  })

  const wallInputs = [
    { name: 'd', type: 'vec3' },
    { name: 'b', type: 'float' },
  ]

  const wallFloor = Fn(([d, b]: N[]) => {
    const a = max(abs(d), vec3(1e-3))
    const lit = vec3(0.02).add(
      vec3(1.0, 0.98, 0.94)
        .mul(4.0)
        .mul(rect(d.xz.div(a.y).sub(vec2(0.0, -0.1)), vec2(0.45, 0.25), b)),
    )
    return select(d.y.lessThan(0), vec3(0), lit)
  }).setLayout({ name: 'wallFloor', type: 'vec3', inputs: wallInputs })

  const wallSide = Fn(([d, b]: N[]) => {
    const a = max(abs(d), vec3(1e-3))
    const uv = d.zy.div(a.x)
    const tint = select(d.x.greaterThan(0), vec3(1.0, 0.94, 0.86), vec3(0.86, 0.94, 1.0))
    return tint.mul(
      smoothstep(-0.6, 0.4, uv.y)
        .mul(0.4)
        .add(rect(uv.sub(vec2(-0.3, 0.2)), vec2(0.25, 0.5), b).mul(1.2)),
    )
  }).setLayout({ name: 'wallSide', type: 'vec3', inputs: wallInputs })

  const wallBack = Fn(([d, b]: N[]) => {
    const a = max(abs(d), vec3(1e-3))
    const uv = d.xy.div(a.z)
    const back = vec3(0.85, 0.95, 1.0)
      .mul(4.0)
      .mul(rect(vec2(abs(uv.x).sub(0.85), uv.y.sub(0.1)), vec2(0.07, 0.6), b))
    const front = vec3(0.25)
      .mul(smoothstep(-0.6, 0.4, uv.y))
      .add(
        vec3(1.0, 0.96, 0.9)
          .mul(0.8)
          .mul(rect(uv.sub(vec2(0.0, 0.4)), vec2(0.5, 0.2), b)),
      )
    return select(d.z.lessThan(0), back, front)
  }).setLayout({ name: 'wallBack', type: 'vec3', inputs: wallInputs })

  const env = Fn(([d, b]: N[]) => {
    const a = abs(d)
    const s = float(0.08).add(b.mul(0.3))
    const w = vec3(
      smoothstep(s.negate(), s, a.x.sub(max(a.y, a.z))),
      smoothstep(s.negate(), s, a.y.sub(max(a.x, a.z))),
      smoothstep(s.negate(), s, a.z.sub(max(a.x, a.y))),
    ).toVar()
    w.divAssign(w.x.add(w.y).add(w.z))
    return wallSide(d, b).mul(w.x).add(wallFloor(d, b).mul(w.y)).add(wallBack(d, b).mul(w.z))
  }).setLayout({ name: 'env', type: 'vec3', inputs: wallInputs })

  const toWorld = (v: N) => u.l2w.mul(v)

  // ---------------- Crystal structure ----------------
  const planePos = (k: N) => sign(float(k)).mul(u.pos.element(abs(k)))

  const plateIndex = Fn(([x]: N[]) => {
    const ax = abs(x)
    const c = int(0).toVar()
    Loop({ start: int(1), end: GN, type: 'int', condition: '<' }, ({ i }: N) => {
      c.addAssign(select(u.pos.element(i).lessThan(ax), int(1), int(0)))
    })
    return c
  }).setLayout({ name: 'plateIndex', type: 'int', inputs: [{ name: 'x', type: 'float' }] })

  // coating of the plane k at (u, v): -1 clear seam, 0 mirror, 1-4 dichroic
  const coatingType = Fn(([k, uv]: N[]) => {
    const fk = float(abs(k))
    const cu = float(plateIndex(uv.x))
    const cv = float(plateIndex(uv.y))
    const hu = hash12(vec2(fk.mul(7).add(cu), 1.0))
    const hv = hash12(vec2(fk.mul(7).add(cv), 1.0))
    const lu = mix(0.15, 1.05, hash12(vec2(fk.mul(7).add(cu), 3.0))).mul(
      sin(u.time.mul(1.3).add(hu.mul(40)))
        .mul(0.25)
        .add(0.75),
    )
    const lv = mix(0.15, 1.05, hash12(vec2(fk.mul(7).add(cv), 3.0))).mul(
      sin(u.time.mul(1.3).add(hv.mul(40)))
        .mul(0.25)
        .add(0.75),
    )
    const su = hu.lessThan(u.coating).and(abs(uv.y).lessThan(lu))
    const sv = hv.lessThan(u.coating).and(abs(uv.x).lessThan(lv))
    const result = int(-1).toVar()
    If(su.or(sv), () => {
      const h = select(su, hu, hv).div(max(u.coating, 1e-4))
      result.assign(
        select(
          h.lessThan(0.65),
          int(0),
          select(
            h.lessThan(0.75),
            int(1),
            select(h.lessThan(0.82), int(2), select(h.lessThan(0.91), int(3), int(4))),
          ),
        ),
      )
    })
    return result
  }).setLayout({
    name: 'coatingType',
    type: 'int',
    inputs: [
      { name: 'k', type: 'int' },
      { name: 'uv', type: 'vec2' },
    ],
  })

  const coatColor = Fn(([kind, cosT]: N[]) => {
    // gold, magenta, cyan, blue
    const ph = select(
      kind.equal(int(1)),
      float(0.9),
      select(kind.equal(int(2)), float(0.1), select(kind.equal(int(3)), float(0.5), float(0.4))),
    ).add(u.filmShift)
    const film = cos(
      ph
        .add(float(1).sub(cosT).mul(0.25))
        .add(vec3(0.0, 0.33, 0.67))
        .mul(2 * Math.PI),
    )
      .mul(0.5)
      .add(0.5)
    return select(kind.equal(int(0)), vec3(u.mirrorR), film.mul(u.filmR))
  }).setLayout({
    name: 'coatColor',
    type: 'vec3',
    inputs: [
      { name: 'kind', type: 'int' },
      { name: 'cosT', type: 'float' },
    ],
  })

  const outside = (o: N) => env(toWorld(o), u.lightSoft)
  const TRAPPED = vec3(0.01, 0.06, 0.06)

  const glassEnv = Fn(([p, d]: N[]) => {
    const te = boxT(p, safeInv(d), 1.0).y
    const n = boxNormal(p.add(d.mul(te))).toVar()
    const o = refract(d, n.negate(), u.ior).toVar()
    const absorb = exp(u.tint.negate().mul(te)).toVar()
    const res = absorb.mul(TRAPPED).toVar()
    If(dot(o, o).greaterThan(0), () => {
      const F = fresnel(dot(o, n))
      res.assign(absorb.mul(mix(outside(o), TRAPPED, F)))
    })
    return res
  }).setLayout({
    name: 'glassEnv',
    type: 'vec3',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 'd', type: 'vec3' },
    ],
  })

  const AXES = ['x', 'y', 'z'] as const

  /**
   * Inline: emits the trace into the current function. With `split`, the
   * first coated plane hands its other branch to (bp, bd, bT) for a second
   * pass, exactly like the original's out params.
   */
  const traceGlass = (p0: N, d0: N, T0: N, split: { bp: N; bd: N; bT: N } | null): N => {
    const p = vec3(p0).toVar()
    const d = vec3(d0).toVar()
    const T = vec3(T0).toVar()
    const acc = vec3(0).toVar()
    const splitting = bool(split !== null).toVar()
    if (split) {
      split.bp.assign(p)
      split.bd.assign(d)
      split.bT.assign(vec3(0))
    }

    const idx = ivec3(0).toVar()
    const stp = ivec3(0).toVar()
    for (const c of AXES) {
      const ci = plateIndex(p[c]).toVar()
      const dPos = d[c].greaterThan(0)
      stp[c].assign(select(dPos, int(1), int(-1)))
      const i0 = select(
        p[c].greaterThanEqual(0),
        select(dPos, ci.add(int(1)), ci),
        select(dPos, ci.negate(), ci.negate().sub(int(1))),
      )
      idx[c].assign(clamp(i0, GN.negate(), GN))
    }

    const bounces = int(0).toVar()
    Loop(MAX_EVENTS, () => {
      const inv = safeInv(d).toVar()
      const tFace = boxT(p, inv, 1.0).y.toVar()
      const tMin = float(1e9).toVar()
      const ax = int(0).toVar()
      AXES.forEach((c, a) => {
        If(abs(idx[c]).lessThan(GN), () => {
          const t = planePos(idx[c]).sub(p[c]).mul(inv[c]).toVar()
          If(t.lessThan(tMin), () => {
            tMin.assign(t)
            ax.assign(int(a))
          })
        })
      })

      If(tFace.lessThanEqual(tMin), () => {
        // outer face
        p.addAssign(d.mul(tFace))
        T.mulAssign(exp(u.tint.negate().mul(tFace)))
        const n = boxNormal(p).toVar()
        const o = refract(d, n.negate(), u.ior).toVar()
        const F = float(1).toVar()
        If(dot(o, o).greaterThan(0), () => {
          F.assign(fresnel(dot(o, n)))
          acc.addAssign(T.mul(float(1).sub(F)).mul(outside(o)))
        })
        T.mulAssign(F)
        bounces.addAssign(int(1))
        If(bounces.greaterThan(int(BOUNCES)).or(maxc(T).lessThan(0.01)), () => {
          Break()
        })
        d.assign(reflect(d, n))
        If(abs(n.x).greaterThan(0.5), () => {
          stp.x.assign(stp.x.negate())
          idx.x.addAssign(stp.x)
        })
          .ElseIf(abs(n.y).greaterThan(0.5), () => {
            stp.y.assign(stp.y.negate())
            idx.y.addAssign(stp.y)
          })
          .Else(() => {
            stp.z.assign(stp.z.negate())
            idx.z.addAssign(stp.z)
          })
        p.subAssign(n.mul(1e-4))
        Continue()
      })

      // internal lamination plane
      p.addAssign(d.mul(tMin))
      T.mulAssign(exp(u.tint.negate().mul(tMin)))
      const k = comp(idx, ax).toVar()
      const uv = select(ax.equal(int(0)), p.yz, select(ax.equal(int(1)), p.zx, p.xy)).toVar()
      const type = coatingType(k, uv).toVar()
      const nP = select(
        ax.equal(int(0)),
        vec3(1, 0, 0),
        select(ax.equal(int(1)), vec3(0, 1, 0), vec3(0, 0, 1)),
      ).toVar()
      If(type.greaterThanEqual(int(0)), () => {
        const R = coatColor(type, abs(comp(d, ax))).toVar()
        const dr = reflect(d, nP).toVar()
        const refl = type.lessThanEqual(int(2))
        const branchSide = () =>
          If(refl, () => {
            acc.addAssign(T.mul(float(1).sub(R)).mul(glassEnv(p, d)))
          }).Else(() => {
            acc.addAssign(T.mul(R).mul(glassEnv(p, dr)))
          })
        if (split) {
          If(splitting, () => {
            splitting.assign(bool(false))
            const dir = select(refl, d, dr)
            split.bp.assign(p.add(dir.mul(1e-4)))
            split.bd.assign(dir)
            split.bT.assign(T.mul(select(refl, float(1).sub(R), R)))
          }).Else(() => {
            branchSide()
          })
        } else {
          branchSide()
        }

        If(refl, () => {
          T.mulAssign(R)
          d.assign(dr)
          setComp(stp, ax, comp(stp, ax).negate())
        }).Else(() => {
          T.mulAssign(float(1).sub(R))
        })
        If(maxc(T).lessThan(0.01), () => {
          Break()
        })
      })
      setComp(idx, ax, k.add(comp(stp, ax)))
    })
    return acc.add(T.mul(TRAPPED))
  }

  const shadeCube = (pl: N, rdl: N): N => {
    const a = abs(pl)
    const n = boxNormal(pl).toVar()
    const e = step(float(1).sub(u.bevel), a)
      .mul(sign(pl))
      .mul(float(1).sub(abs(n)))
    const nb = normalize(n.add(e.mul(0.7))).toVar()
    If(dot(rdl, nb).lessThan(-0.05), () => {
      n.assign(nb)
    })
    const F = fresnel(dot(rdl, n).negate()).toVar()
    const col = env(toWorld(reflect(rdl, n)), u.reflSoft)
      .mul(F)
      .toVar()
    const bp = vec3(0).toVar()
    const bd = vec3(0).toVar()
    const bT = vec3(0).toVar()
    col.addAssign(
      float(1)
        .sub(F)
        .mul(traceGlass(pl, refract(rdl, n, float(1).div(u.ior)), vec3(1), { bp, bd, bT })),
    )
    If(maxc(bT).greaterThan(0.01), () => {
      col.addAssign(
        float(1)
          .sub(F)
          .mul(traceGlass(bp, bd, bT, null)),
      )
    })
    return col
  }

  const render = (fragCoord: N): N => {
    const res = screenSize
    const sc = min(res.x, res.y)
    const uv = fragCoord.mul(2).sub(res).div(sc)
    const tanH = tan(radians(u.fov).mul(0.5))
    const rd = normalize(
      vec3(CAM_FW.x, CAM_FW.y, CAM_FW.z).add(
        vec3(CAM_RT.x, CAM_RT.y, CAM_RT.z)
          .mul(uv.x)
          .add(vec3(CAM_UP.x, CAM_UP.y, CAM_UP.z).mul(uv.y))
          .mul(tanH),
      ),
    )
    const rel = CAM_RO.clone().sub(CUBE_C)
    const rol = u.w2l.mul(vec3(rel.x, rel.y, rel.z)).toVar()
    const rdl = u.w2l.mul(rd).toVar()
    const tb = boxT(rol, safeInv(rdl), 1.0).toVar()
    const out = vec3(0).toVar()
    If(tb.x.greaterThan(0).and(tb.x.lessThan(tb.y)), () => {
      const cover = clamp(tb.y.sub(tb.x).div(tb.x.mul(3).mul(tanH).div(sc)), 0, 1)
      out.assign(shadeCube(rol.add(rdl.mul(tb.x)), rdl).mul(cover))
    })
    return out
  }

  const fragment = Fn(() => {
    // TSL's screenCoordinate is top-left on both backends; the original is GL bottom-left.
    const fc = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y)).toVar()
    const col = vec3(0).toVar()
    Loop(AA, AA, ({ i, j }: N) => {
      col.addAssign(render(fc.add(vec2(float(i), float(j)).add(0.5).div(AA).sub(0.5))))
    })
    col.divAssign(AA * AA)
    const mapped = aces(col.mul(u.exposure)).toVar()
    // Dither, in display space so it stays 1/255 after the sRGB encode.
    const display = pow(mapped, vec3(1 / 2.2)).add(hash12(fc).sub(0.5).div(255))
    return vec4(pow(max(display, vec3(0)), vec3(2.2)), 1)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.fragmentNode = fragment()
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return { material, u }
}

class DistilledCube implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly mesh: THREE.Mesh
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicNodeMaterial
  private readonly u: ReturnType<typeof buildMaterial>['u']
  private readonly gridN: number

  private spin = 1.3
  private crystalTime = 0
  private readonly dragQuat = new THREE.Quaternion()
  private readonly identityQuat = new THREE.Quaternion()
  private readonly qYaw = new THREE.Quaternion()
  private readonly qPitch = new THREE.Quaternion()
  private readonly tmpM4 = new THREE.Matrix4()
  private readonly dragT = new THREE.Matrix3()
  private readonly spinM = new THREE.Matrix3()
  private resetting = false
  private readonly drag = {
    active: false,
    id: -1,
    lastX: 0,
    lastY: 0,
    accX: 0,
    accY: 0,
    velX: 0,
    velY: 0,
  }
  /** Extra spin (rad/s) from Spin kick, around the vertical axis so the cube stays on its corner. */
  private kickVel = 0

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    const p = ctx.params
    this.gridN = Math.round(num(p.gridN, 15))
    const built = buildMaterial(
      this.gridN,
      Math.round(num(p.maxEvents, 104)),
      Math.round(num(p.bounces, 7)),
      Math.round(num(p.aa, 1)),
    )
    this.material = built.material
    this.u = built.u
    // Fullscreen triangle.
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
      this.drag.velX = this.drag.velY = 0
      this.resetting = true
    }
  }

  pointer(ev: ScenePointerEvent) {
    const drag = this.drag
    if (ev.type === 'down') {
      if (drag.active) return
      drag.active = true
      drag.id = ev.id
      drag.lastX = ev.x
      drag.lastY = ev.y
      drag.accX = drag.accY = 0
      this.resetting = false
    } else if (ev.id === drag.id && drag.active) {
      if (ev.type === 'move') {
        drag.accX += ev.x - drag.lastX
        drag.accY += ev.y - drag.lastY
        drag.lastX = ev.x
        drag.lastY = ev.y
      } else {
        drag.active = false
      }
    }
  }

  private applyParams(p: Readonly<ParamValues>) {
    const u = this.u
    u.fov.value = num(p.fov, 34)
    u.ior.value = num(p.glassIor, 1.7)
    u.coating.value = num(p.coating, 0.22)
    u.mirrorR.value = num(p.mirrorR, 0.6)
    u.filmR.value = num(p.filmR, 1.21)
    u.filmShift.value = num(p.filmShift, 0)
    u.reflSoft.value = num(p.reflSoft, 0.35)
    u.lightSoft.value = num(p.lightSoft, 0.12)
    u.bevel.value = num(p.bevel, 0.012)
    u.exposure.value = num(p.exposure, 1.9)
    const [r, g, b] = rotateHue(hexToRgb(String(p.glassColor ?? '#65f3f3')), num(p.hueShift, 0))
    const k = num(p.glassDensity, 1)
    u.tint.value.set(
      -Math.log(Math.max(r, 1e-3)) * k,
      -Math.log(Math.max(g, 1e-3)) * k,
      -Math.log(Math.max(b, 1e-3)) * k,
    )
  }

  private updatePlanes(p: Readonly<ParamValues>, time: number) {
    const pos = this.u.pos.array as number[]
    const n = this.gridN
    const move = num(p.crystalMove, 0.35)
    const gamma = num(p.gridGamma, 0.7)
    const wobble = num(p.wobble, 0) * 0.04
    pos[0] = 0
    for (let i = 1; i < n; i++) {
      const jitter = wobble * Math.sin(time * 23 + i * 2.3)
      const x = (i + move * Math.sin(this.crystalTime + i * 1.7) + jitter * n) / n
      pos[i] = Math.pow(Math.min(Math.max(x, 0), 1), gamma)
    }
    // Keep plane order strictly increasing (wobble must not cross plates).
    for (let i = 1; i < n; i++) if (pos[i]! <= pos[i - 1]!) pos[i] = pos[i - 1]! + 1e-4
  }

  private updateDrag(dt: number, p: Readonly<ParamValues>) {
    const drag = this.drag
    const MAX_VEL = 14
    if (drag.active) {
      const k = 0.006 * num(p.dragSensitivity, 1)
      const tx = THREE.MathUtils.clamp((drag.accX * k) / dt, -MAX_VEL, MAX_VEL)
      const ty = THREE.MathUtils.clamp((drag.accY * k) / dt, -MAX_VEL, MAX_VEL)
      drag.accX = drag.accY = 0
      const f = 1 - Math.exp(-dt / Math.max(num(p.smoothing, 0.06), 1e-3))
      drag.velX += (tx - drag.velX) * f
      drag.velY += (ty - drag.velY) * f
    } else {
      const decay = Math.exp(-dt / Math.max(num(p.inertia, 0.9), 1e-3))
      drag.velX *= decay
      drag.velY *= decay
    }

    const ax = drag.velX * dt
    const ay = drag.velY * dt
    if (Math.abs(ax) + Math.abs(ay) > 1e-7) {
      this.qYaw.setFromAxisAngle(CAM_UP, ax)
      this.qPitch.setFromAxisAngle(CAM_RT, ay)
      this.dragQuat.premultiply(this.qPitch).premultiply(this.qYaw).normalize()
    }
    if (this.resetting) {
      this.dragQuat.slerp(this.identityQuat, 1 - Math.exp(-dt * 4))
      if (this.dragQuat.angleTo(this.identityQuat) < 1e-3) {
        this.dragQuat.identity()
        this.resetting = false
      }
    }
  }

  private updateOrientation() {
    // world -> local = TILT * rotY(-spin) * transpose(drag)
    const c = Math.cos(-this.spin)
    const s = Math.sin(-this.spin)
    const e = this.spinM.elements
    e[0] = c
    e[1] = 0
    e[2] = -s
    e[3] = 0
    e[4] = 1
    e[5] = 0
    e[6] = s
    e[7] = 0
    e[8] = c
    this.tmpM4.makeRotationFromQuaternion(this.dragQuat)
    this.dragT.setFromMatrix4(this.tmpM4).transpose()
    const w2l = this.u.w2l.value as THREE.Matrix3
    w2l.multiplyMatrices(TILT, this.spinM).multiply(this.dragT)
    ;(this.u.l2w.value as THREE.Matrix3).copy(w2l).transpose()
  }

  update(frame: SceneFrame) {
    const { dt, params: p } = frame
    const rot = num(p.rotSpeed, 0.12)
    // Spin kick pushes along the current spin direction and coasts down with Inertia.
    this.kickVel += num(p.spinKick, 0) * 5 * dt * (rot < 0 ? -1 : 1)
    this.kickVel *= Math.exp(-dt / Math.max(num(p.inertia, 0.9), 0.05))
    this.spin += dt * (rot + this.kickVel)
    this.crystalTime += dt * num(p.crystalSpeed, 0.35)
    this.u.time.value = this.crystalTime
    this.applyParams(p)
    this.updateDrag(dt, p)
    this.updateOrientation()
    this.updatePlanes(p, frame.time)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new DistilledCube(ctx)
  await scene.compile()
  return scene
}
