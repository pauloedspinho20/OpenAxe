/**
 * Digital Core node materials - TSL ports of the original GLSL chunks
 * (COMMON / FACE / CORE_LIB / LIGHT_LIB / ENV_LIB / CODE_LIB and the five
 * material shaders). See ./scene.ts for what changed from the original.
 *
 * WGSL notes that shape the code:
 * - Derivatives (fwidth / dFdx) are only legal in uniform control flow, and
 *   TSL emits a node where it is first used. Everything derivative-based is
 *   therefore computed and `.toVar()`ed at the top of each fragment
 *   function, before any `If` on per-fragment values.
 * - Helper functions return packed vectors instead of GLSL `out` params.
 * - The depth-of-field layer weight (dofWeight) is gone: DOF is a post pass
 *   now, so every fragment has weight 1.
 */
import * as THREE from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  inverseSqrt,
  length,
  max,
  min,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  reflect,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uniformArray,
  varying,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

export function createUniforms() {
  return {
    time: uniform(0),
    flowTime: uniform(0),
    driftTime: uniform(0),
    moveTime: uniform(0),
    codeTime: uniform(0),
    breath: uniform(0.4),
    viewport: uniform(new THREE.Vector2(1, 1)),
    fog: uniform(0.055),
    dotSize: uniform(0.6),
    base: uniform(new THREE.Color('#010409')),
    panel: uniform(new THREE.Color('#1f78b8')),
    glass: uniform(new THREE.Color('#3c94d6')),
    highlight: uniform(new THREE.Color('#a8e8ff')),
    core: uniform(new THREE.Color('#ff8526')),
    coreHot: uniform(new THREE.Color('#ffe2b8')),
    haze: uniform(new THREE.Color('#164f80')),
    env: uniform(new THREE.Color('#cfe4ff')),
    panelBright: uniform(1),
    glassIntensity: uniform(1),
    edgeGlow: uniform(1),
    coreGlow: uniform(1),
    innerGlow: uniform(1),
    codeBright: uniform(1),
    codeColumns: uniform(8),
    corePulse: uniform(0.55),
    flicker: uniform(0.6),
    lineIntensity: uniform(1),
    particleIntensity: uniform(1),
    hazeAmount: uniform(1),
    coreLight: uniform(1),
    reflect: uniform(1),
    lineWidth: uniform(1),
    /** Extra (audio): multiplies the core blocks' light. */
    flash: uniform(0),
    camRight: uniform(new THREE.Vector3(1, 0, 0)),
    camUp: uniform(new THREE.Vector3(0, 1, 0)),
    edgeA: uniformArray(
      Array.from({ length: 12 }, () => new THREE.Vector4()),
      'vec4',
    ),
    edgeB: uniformArray(
      Array.from({ length: 12 }, () => new THREE.Vector3()),
      'vec3',
    ),
  }
}

export type Uniforms = ReturnType<typeof createUniforms>

const TAU = 6.2831853

export function createMaterials(u: Uniforms, glyphs: THREE.Texture) {
  // ——— COMMON ———
  const farFog = (z: N) => exp(u.fog.negate().mul(max(z.sub(5.0), 0.0)))
  const nearFade = (z: N) => smoothstep(0.3, 2.0, z)
  const fogFactor = (z: N) => farFog(z).mul(nearFade(z))

  const hash12 = Fn(([p]: N[]) => {
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar()
    p3.addAssign(dot(p3, p3.yzx.add(33.33)))
    return fract(p3.x.add(p3.y).mul(p3.z))
  }).setLayout({ name: 'dcHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

  const hash11 = Fn(([x]: N[]) => {
    const p = fract(x.mul(0.1031)).toVar()
    p.mulAssign(p.add(33.33))
    p.mulAssign(p.add(p))
    return fract(p)
  }).setLayout({ name: 'dcHash11', type: 'float', inputs: [{ name: 'x', type: 'float' }] })

  const hash31 = Fn(([q]: N[]) => {
    const p = fract(q.mul(0.1031)).toVar()
    p.addAssign(dot(p, p.zyx.add(31.32)))
    return fract(p.x.add(p.y).mul(p.z))
  }).setLayout({ name: 'dcHash31', type: 'float', inputs: [{ name: 'q', type: 'vec3' }] })

  const vnoise = Fn(([p]: N[]) => {
    const i = floor(p).toVar()
    const f0 = fract(p)
    const f = f0
      .mul(f0)
      .mul(vec3(3.0).sub(f0.mul(2.0)))
      .toVar()
    const a = hash31(i)
    const b = hash31(i.add(vec3(1, 0, 0)))
    const c = hash31(i.add(vec3(0, 1, 0)))
    const d = hash31(i.add(vec3(1, 1, 0)))
    const e = hash31(i.add(vec3(0, 0, 1)))
    const g = hash31(i.add(vec3(1, 0, 1)))
    const h = hash31(i.add(vec3(0, 1, 1)))
    const k = hash31(i.add(vec3(1, 1, 1)))
    return mix(
      mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
      mix(mix(e, g, f.x), mix(h, k, f.x), f.y),
      f.z,
    )
  }).setLayout({ name: 'dcNoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] })

  // ——— LIGHT_LIB: 12 line lights along the cube edges -> vec4(dir, intensity) ———
  const edgeLight = Fn(([p]: N[]) => {
    const sum = float(0).toVar()
    const dsum = vec3(0).toVar()
    Loop(12, ({ i }: N) => {
      const A = u.edgeA.element(i)
      const a = A.xyz
      const ab = u.edgeB.element(i).sub(a)
      const h = clamp(dot(p.sub(a), ab).div(max(dot(ab, ab), 1e-4)), 0.0, 1.0)
      const v = a.add(ab.mul(h)).sub(p).toVar()
      const d2 = dot(v, v)
      const q = d2.mul(14.0).add(1.0)
      const w = A.w.div(q.mul(q)).toVar()
      sum.addAssign(w)
      dsum.addAssign(v.mul(w.mul(inverseSqrt(d2.add(1e-4)))))
    })
    return vec4(dsum.div(max(length(dsum), 1e-4)), sum.mul(u.coreLight))
    // No setLayout: a uniformArray read only inside a layout function is never
    // bound to the stage ("unresolved value NodeBuffer_*"), so this inlines.
  })

  // ——— ENV_LIB ———
  const envLight = Fn(([r]: N[]) => {
    const key = pow(max(dot(r, normalize(vec3(0.45, 0.85, 0.3))), 0.0), 28.0)
    const strip = float(1)
      .sub(smoothstep(0.0, 0.06, abs(dot(r, normalize(vec3(0.9, 0.0, -0.45))))))
      .mul(smoothstep(-0.2, 0.6, r.y))
    const rim = float(1)
      .sub(smoothstep(0.0, 0.04, abs(dot(r, normalize(vec3(-0.3, 0.25, 0.92))))))
      .mul(smoothstep(0.0, 0.5, r.x.negate().add(0.3)))
    const sky = r.y.mul(0.5).add(0.5).mul(0.04).add(0.03)
    return u.env.mul(key.mul(1.8).add(strip.mul(0.9)).add(rim.mul(0.7)).add(sky))
  })

  const fresnelSchlick = (ndv: N, f0: number) => {
    const m = float(1).sub(clamp(ndv, 0.0, 1.0))
    const m2 = m.mul(m)
    return float(f0).add(
      float(1 - f0)
        .mul(m2)
        .mul(m2)
        .mul(m),
    )
  }

  // ——— CORE_LIB ———
  const coreIntensity = Fn(([center, seed, bright]: N[]) => {
    const fl0 = sin(u.time.mul(hash11(seed.mul(3.7)).mul(1.8).add(0.6)).add(seed.mul(TAU)))
      .mul(0.38)
      .add(0.62)
    const fl = mix(float(1), fl0, u.flicker)
    const wave = sin(u.time.mul(0.55).add(dot(center, vec3(1.3, 0.9, -1.1))))
      .mul(0.5)
      .add(0.5)
    const pulse = float(1).add(
      u.corePulse.mul(
        sin(u.time.mul(0.42))
          .mul(0.45)
          .add(sin(u.time.mul(1.13).add(1.7)).mul(0.3))
          .add(wave.sub(0.5).mul(0.6)),
      ),
    )
    return max(bright.mul(fl).mul(pulse), 0.4).mul(u.coreGlow).mul(u.flash.add(1))
  })

  const fireNoise = Fn(([p, seed]: N[]) => {
    const nz = vnoise(p.mul(2.4).add(vec3(0.0, u.time.mul(0.18), seed)))
      .mul(0.7)
      .add(vnoise(p.mul(6.5).sub(vec3(u.time.mul(0.25)))).mul(0.3))
    return smoothstep(0.3, 0.9, nz)
  })

  const fireColor = (inten: N, fire: N, edge: N) => {
    const hot = clamp(inten.sub(1.15).mul(1.4), 0.0, 1.0)
    return mix(
      u.core,
      u.coreHot,
      clamp(hot.mul(0.85).add(fire.mul(fire).mul(0.42)).add(edge.mul(0.15)), 0.0, 1.0),
    )
  }

  const erfApprox = Fn(([x]: N[]) => {
    const x2 = x.mul(x)
    return sign(x).mul(
      sqrt(
        float(1).sub(exp(x2.negate().mul(x2.mul(0.147).add(1.2732395)).div(x2.mul(0.147).add(1)))),
      ),
    )
  }).setLayout({ name: 'dcErf', type: 'float', inputs: [{ name: 'x', type: 'float' }] })

  // ——— FACE ———
  /** vec4(face coords, face half extents) for the current box face, clamped. */
  const faceFrame = (n: N, local: N, half: N) => {
    const an = abs(n)
    const fr = select(
      an.x.greaterThan(0.5),
      vec4(local.yz, half.yz),
      select(an.y.greaterThan(0.5), vec4(local.xz, half.xz), vec4(local.xy, half.xy)),
    )
    return vec4(clamp(fr.xy, fr.zw.negate(), fr.zw), fr.zw)
  }

  /** LED dot matrix -> vec3(coverage, cell). Uses fwidth: call at the top level only. */
  const dotGrid = (q: N, pitch: N) => {
    const g = q.div(pitch).toVar()
    const cell = floor(g)
    const f = fract(g).sub(0.5)
    const d = max(abs(f.x), abs(f.y))
    const fw = fwidth(g)
    const aa = max(max(fw.x, fw.y), 1e-4).toVar()
    const r = u.dotSize.mul(0.5)
    const m = float(1).sub(smoothstep(r.sub(aa), r.add(aa), d))
    return vec3(mix(m, u.dotSize.mul(u.dotSize), smoothstep(0.25, 0.7, aa)), cell).toVar()
  }

  /** Uses fwidth: call at the top level only. */
  const edgeLine = (e: N, width: number) => {
    const fw = fwidth(e)
    return float(1)
      .sub(smoothstep(float(width), fw.mul(1.5).add(width + 1e-5), e))
      .toVar()
  }

  // ——— CODE_LIB ———
  /** vec4(uv, size): right-handed text frame on a box face seen along -n. */
  const textFrame = (n: N, p: N, h: N) => {
    const an = abs(n)
    return select(
      an.x.greaterThan(0.5),
      vec4(sign(n.x).mul(p.y), p.z, h.y.mul(2), h.z.mul(2)),
      select(
        an.y.greaterThan(0.5),
        vec4(sign(n.y).mul(p.z), p.x, h.z.mul(2), h.x.mul(2)),
        vec4(sign(n.z).mul(p.x), p.y, h.x.mul(2), h.y.mul(2)),
      ),
    )
  }

  /** The code grid coordinate; its derivatives are taken at the top level. */
  const codeGrid = (frame: N, seed: N) => {
    const cw = frame.z.div(u.codeColumns.add(0.7))
    const chh = cw.mul(1.45)
    return vec2(
      frame.x.div(cw).add(u.codeColumns.mul(0.5)),
      frame.y.div(chh).sub(u.codeTime.mul(0.45)).add(seed.mul(3.0)),
    )
  }

  /** Rows of 8-bit bytes: bits flip at random rates, rows scroll up. */
  const binaryCode = (frame: N, g: N, gx: N, gy: N, faceId: N, seed: N) => {
    const cw = frame.z.div(u.codeColumns.add(0.7))
    const chh = cw.mul(1.45)
    const cell = floor(g)
    const f = fract(g)
    const inCols = step(0.0, cell.x).mul(step(cell.x, u.codeColumns.sub(1.0)))
    const rowKey = cell.y.add(faceId.mul(31.0))
    const rate = hash12(vec2(rowKey, seed)).mul(2.0).add(0.35)
    const flip = floor(u.codeTime.mul(rate).add(hash12(cell.add(seed)).mul(5.0)))
    const bit = step(
      0.5,
      hash12(vec2(cell.x.mul(1.37).add(faceId.mul(5.3)).add(seed), cell.y.add(flip.mul(13.1)))),
    )
    const a0 = texture(glyphs, vec2(bit.add(f.x).mul(0.5), f.y)).grad(gx, gy).r
    const tiny = max(max(abs(gx.x), abs(gx.y)), max(abs(gy.x), abs(gy.y))).mul(2.0)
    const a = mix(a0, 0.2, smoothstep(0.45, 1.0, tiny))
    const rowGlow = hash12(vec2(rowKey, seed.add(3.7)))
      .mul(0.6)
      .add(0.55)
    const vFade = float(1).sub(
      smoothstep(frame.w.mul(0.5).sub(chh.mul(0.5)), frame.w.mul(0.5), abs(frame.y)),
    )
    return a.mul(inCols).mul(vFade).mul(rowGlow)
  }

  // ——— Box instancing (BOX_VERT) ———
  const aCenter = attribute('aCenter', 'vec3')
  const aSize = attribute('aSize', 'vec3')
  const aParams = attribute('aParams', 'vec4')
  const aMotion = attribute('aMotion', 'vec4')

  /** GLSL mod for a positive divisor (WGSL % truncates toward zero). */
  const fmod = (x: N, y: number) => x.sub(floor(x.div(y)).mul(y))

  const moving = aMotion.x.greaterThan(-0.5)
  const T = u.moveTime.mul(abs(aMotion.w)).add(aMotion.z)
  const e0 = clamp(fract(T).sub(0.55).div(0.45), 0.0, 1.0)
  const ease = e0
    .mul(e0)
    .mul(e0)
    .mul(e0.mul(e0.mul(6.0).sub(15.0)).add(10.0))
  const sRaw = aMotion.y.add(sign(aMotion.w).mul(0.5).mul(floor(T).add(ease)))
  const s = fmod(sRaw.add(1.0), 2.0).sub(1.0)
  const growMove = float(1).sub(smoothstep(0.78, 1.0, abs(s)))
  const shifted = select(
    aMotion.x.lessThan(0.5),
    vec3(s, aCenter.y, aCenter.z),
    select(aMotion.x.lessThan(1.5), vec3(aCenter.x, s, aCenter.z), vec3(aCenter.x, aCenter.y, s)),
  ).mul(
    u.breath
      .mul(0.07)
      .mul(sin(u.time.mul(0.8).add(aMotion.z.mul(TAU))))
      .add(1.0),
  )
  const boxCenter = select(moving, shifted, aCenter)
  const boxSize = aSize.mul(select(moving, growMove, float(1)))
  const boxLocal = positionGeometry.mul(boxSize)

  const vLocal = varying(boxLocal, 'vLocal')
  const vHalf = varying(boxSize.mul(0.5), 'vHalf')
  const vParams = varying(aParams, 'vParams')
  const vCloud = varying(vnoise(aCenter.mul(2.2).add(aParams.x)), 'vCloud')
  const vNrm = normalGeometry

  const boxPosition = boxCenter.add(boxLocal)

  // ——— SOLID_FRAG: room blocks, dark core cubes, glowing amber blocks ———
  const solidFragment = Fn(() => {
    const viewZ = positionView.z.negate().toVar()
    const world = positionWorld.toVar()
    const fr = faceFrame(vNrm, vLocal, vHalf).toVar()
    const fc = fr.xy
    const fh = fr.zw
    const ed = fh.sub(abs(fc))
    const e = min(ed.x, ed.y).toVar()
    const seed = vParams.x.toVar()
    const kindV = vParams.y.toVar()
    const bright = vParams.z.toVar()
    const center = world.sub(vLocal).toVar()
    const facing = clamp(dot(vNrm, normalize(center.add(1e-4)).negate()), 0.0, 1.0)
    const dg = dotGrid(fc.add(fh), select(kindV.greaterThan(0.5), float(0.035), float(0.075)))
    const dm = dg.x
    const cell = dg.yz
    const hc = hash12(cell.add(seed.mul(31.7))).toVar()
    const line = edgeLine(e, 0.008)

    // Glass-block ray setup + code-grid derivatives, in uniform control flow.
    const h = max(vHalf, vec3(1e-4)).toVar()
    const ro = clamp(vLocal, h.negate(), h).toVar()
    const rd = normalize(world.sub(cameraPosition)).toVar()
    const rs = vec3(
      select(rd.x.greaterThanEqual(0), float(1), float(-1)),
      select(rd.y.greaterThanEqual(0), float(1), float(-1)),
      select(rd.z.greaterThanEqual(0), float(1), float(-1)),
    ).toVar()
    const invAbs = vec3(1)
      .div(max(abs(rd), vec3(1e-5)))
      .toVar()
    const tF = rs.mul(h).sub(ro).mul(rs).mul(invAbs).toVar()
    const tExit = max(min(min(tF.x, tF.y), tF.z), 0.0).toVar()
    const nExit = select(
      tF.x.lessThan(tF.y).and(tF.x.lessThan(tF.z)),
      vec3(rs.x, 0, 0),
      select(tF.y.lessThan(tF.z), vec3(0, rs.y, 0), vec3(0, 0, rs.z)),
    ).toVar()
    const pExit = ro.add(rd.mul(tExit)).toVar()
    const frontFrame = textFrame(vNrm, ro, h).toVar()
    const backFrame = textFrame(nExit.negate(), pExit, h).toVar()
    const gFront = codeGrid(frontFrame, seed).toVar()
    const gBack = codeGrid(backFrame, seed).toVar()
    const gxFront = dFdx(gFront).mul(vec2(0.5, 1.0)).toVar()
    const gyFront = dFdy(gFront).mul(vec2(0.5, 1.0)).toVar()
    const gxBack = dFdx(gBack).mul(vec2(0.5, 1.0)).mul(2.5).toVar()
    const gyBack = dFdy(gBack).mul(vec2(0.5, 1.0)).mul(2.5).toVar()

    const col = vec3(u.base).toVar()
    If(kindV.lessThan(0.5), () => {
      const macro = floor(cell.div(vec2(6.0, 4.0)))
      const hm = hash12(macro.add(seed.mul(17.3)))
      const level = select(
        hm.lessThan(0.4),
        float(0.06),
        select(hm.lessThan(0.7), float(0.45), select(hm.lessThan(0.92), float(0.9), float(1.5))),
      ).mul(hc.mul(0.8).add(0.6))
      const spark = step(0.982, hc).mul(
        sin(u.time.mul(hash12(cell.add(3.1)).mul(2.5).add(0.7)).add(hc.mul(50.0)))
          .mul(0.45)
          .add(0.55),
      )
      const faceLit = mix(0.35, 1.0, facing)
      const fall = exp(max(length(world).sub(6.0), 0.0).mul(-0.05))
      col.addAssign(
        u.panel
          .mul(dm.mul(level).add(0.04))
          .mul(bright)
          .mul(faceLit)
          .mul(u.panelBright)
          .mul(fall)
          .mul(2.6),
      )
      col.addAssign(u.highlight.mul(dm).mul(spark).mul(bright).mul(1.4).mul(fall))
      col.addAssign(u.panel.mul(line).mul(u.edgeGlow).mul(0.5).mul(bright).mul(faceLit))
    })
      .ElseIf(kindV.lessThan(1.5), () => {
        // black glass: faint micro grid, orange light from the ring, studio reflections
        const V = normalize(cameraPosition.sub(world)).toVar()
        const ndv = max(dot(vNrm, V), 0.0)
        const el = edgeLight(world).toVar()
        const diff = max(dot(vNrm, el.xyz), 0.0)
        const F = fresnelSchlick(ndv, 0.04).toVar()
        col.assign(
          u.base
            .mul(0.35)
            .add(u.panel.mul(dm.mul(0.012).mul(hc.add(0.4)).add(line.mul(0.035).mul(u.edgeGlow)))),
        )
        col.addAssign(
          mix(u.core, u.coreHot, 0.15)
            .mul(el.w)
            .mul(diff.mul(0.3).add(F.mul(0.4)).add(line.mul(0.5)).add(dm.mul(0.015))),
        )
        col.addAssign(envLight(reflect(V.negate(), vNrm)).mul(F).mul(u.reflect).mul(0.9))
      })
      .Else(() => {
        // glowing glass block: the view ray traced through the box in local space
        const hmin = min(min(h.x, h.y), h.z)
        const sig = hmin.mul(0.42)
        const b = dot(ro, rd).toVar()
        const d2 = max(dot(ro, ro).sub(b.mul(b)), 0.0)
        const k = float(0.70710678).div(sig).toVar()
        const coreL = exp(d2.negate().div(sig.mul(sig).mul(2.0)))
          .mul(0.5)
          .mul(erfApprox(tExit.add(b).mul(k)).sub(erfApprox(b.mul(k))))
          .toVar()
        const thick = tExit.div(hmin.mul(2.0))
        const inten = coreIntensity(center, seed, bright).toVar()
        const fire = fireNoise(world.add(rd.mul(tExit).mul(0.5)), seed)
        const codeFront = binaryCode(
          frontFrame,
          gFront,
          gxFront,
          gyFront,
          dot(vNrm, vec3(1.0, 2.0, 3.0)),
          seed,
        )
        const codeBack = binaryCode(
          backFrame,
          gBack,
          gxBack,
          gyBack,
          dot(nExit, vec3(4.0, 5.0, 6.0)),
          seed,
        )
        // inner nucleus: a small glowing cube floating in the centre
        const hn = h.mul(0.34)
        const tN0 = rs.negate().mul(hn).sub(ro).mul(rs).mul(invAbs)
        const tN1 = rs.mul(hn).sub(ro).mul(rs).mul(invAbs)
        const tIn = max(max(tN0.x, tN0.y), tN0.z)
        const tOut = min(min(tN1.x, tN1.y), tN1.z)
        const nucleus = clamp(
          tOut.sub(max(tIn, 0.0)).div(min(min(hn.x, hn.y), hn.z).mul(2.0)),
          0.0,
          1.5,
        )
        const rim = exp(e.mul(-22.0))
        const warm = mix(u.core, u.coreHot, 0.5)
        const body = u.core
          .mul(thick.mul(fire.mul(0.8).add(0.5)).mul(0.4).add(0.06))
          .add(
            mix(u.core, u.coreHot, coreL)
              .mul(pow(max(coreL, 0.0), 1.3))
              .mul(0.55),
          )
          .add(mix(u.coreHot, vec3(1.0), 0.2).mul(nucleus).mul(0.7))
        const F = fresnelSchlick(max(dot(vNrm, rd.negate()), 0.0), 0.04)
        const refl = envLight(reflect(rd, vNrm)).mul(F).mul(u.reflect)
        const code = mix(u.coreHot, vec3(1.0), 0.25)
          .mul(codeFront)
          .mul(coreL.mul(1.9).add(0.55).add(thick.mul(0.45)))
          .add(u.core.mul(codeBack).mul(coreL.mul(0.5).add(0.2)))
        col.assign(
          u.base
            .add(
              inten.mul(
                body
                  .mul(u.innerGlow)
                  .add(code.mul(u.codeBright))
                  .add(warm.mul(line.mul(0.35).add(rim.mul(0.08)))),
              ),
            )
            .add(refl.mul(0.9)),
        )
      })
    // far: fog darkens; near the camera: fade out instead of a black occluder
    const a = nearFade(viewZ).toVar()
    Discard(a.lessThan(0.004))
    return vec4(col.mul(farFog(viewZ)).mul(a), a)
  })

  // ——— GLOW_FRAG: glass shell, translucent sheaths, light beams (additive) ———
  const glowFragment = Fn(() => {
    const viewZ = positionView.z.negate().toVar()
    const world = positionWorld.toVar()
    const fr = faceFrame(vNrm, vLocal, vHalf).toVar()
    const fc = fr.xy
    const fh = fr.zw
    const ed = fh.sub(abs(fc))
    const e = min(ed.x, ed.y).toVar()
    const seed = vParams.x.toVar()
    const kindV = vParams.y.toVar()
    const bright = vParams.z.toVar()
    const V = normalize(cameraPosition.sub(world)).toVar()
    const ndvS = dot(vNrm, V).toVar()
    const fres = float(1).sub(abs(ndvS)).toVar()
    const dg = dotGrid(fc.add(fh), float(0.032))
    const dm = dg.x
    const cell = dg.yz
    const hc = hash12(cell.add(seed.mul(13.1))).toVar()
    const line = edgeLine(e, 0.004)
    const halo = exp(e.mul(-30.0)).toVar()
    const col = vec3(0).toVar()
    If(kindV.lessThan(0.5), () => {
      const hm = hash12(floor(cell.div(vec2(4.0, 3.0))).add(seed.mul(7.7)))
      const level = step(0.55, hm).mul(0.88).add(0.12).toVar()
      const cloud = vCloud.mul(1.1).add(0.3)
      col.assign(
        u.glass
          .mul(dm.mul(level).mul(0.035).mul(hc.add(0.5)).mul(cloud).add(fres.mul(0.008)).add(0.003))
          .mul(u.glassIntensity),
      )
      col.addAssign(
        mix(u.glass, u.highlight, 0.25)
          .mul(line.mul(0.065).add(halo.mul(0.008)))
          .mul(u.edgeGlow),
      )
      col.addAssign(
        u.highlight
          .mul(dm)
          .mul(step(0.96, hc))
          .mul(0.5)
          .mul(
            sin(u.time.mul(2.0).add(hc.mul(40.0)))
              .mul(0.4)
              .add(0.6),
          ),
      )
      col.mulAssign(bright)
      const el = edgeLight(world).toVar()
      col.addAssign(
        mix(u.core, u.coreHot, 0.2)
          .mul(el.w)
          .mul(
            line
              .mul(0.12)
              .add(halo.mul(0.02))
              .add(dm.mul(level).mul(0.04))
              .add(fres.mul(0.015))
              .add(0.012),
          ),
      )
      const n = select(ndvS.lessThan(0.0), vNrm.negate(), vNrm)
      col.addAssign(
        envLight(reflect(V.negate(), n))
          .mul(fresnelSchlick(abs(ndvS), 0.04))
          .mul(u.reflect)
          .mul(0.45),
      )
    })
      .ElseIf(kindV.lessThan(1.5), () => {
        // translucent sheath around a solid glow block
        const center = world.sub(vLocal)
        const inten = coreIntensity(center, seed, bright).toVar()
        const fire = fireNoise(world, seed).toVar()
        const c = fireColor(inten, fire, line)
        col.assign(c.mul(inten).mul(fire.mul(0.05).add(0.02).add(fres.mul(0.05))))
      })
      .Else(() => {
        col.assign(
          mix(u.glass, u.highlight, 0.5).mul(bright).mul(line.mul(0.12).add(0.12)).mul(u.edgeGlow),
        )
      })
    return vec4(col.mul(fogFactor(viewZ)), 0.0)
  })

  // ——— LINE_VERT / LINE_FRAG: screen-space thin lines with travelling pulses ———
  const lAlong = varyingProperty('float', 'lAlong')
  const lSide = varyingProperty('float', 'lSide')
  const lWidthPx = varyingProperty('float', 'lWidthPx')
  const lFade = varyingProperty('float', 'lFade')
  const lViewZ = varyingProperty('float', 'lViewZ')
  const lWarm = varyingProperty('float', 'lWarm')
  const aStart = attribute('aStart', 'vec3')
  const aDirLen = attribute('aDirLen', 'vec4')
  const lParams = varying(attribute('aParams', 'vec4'), 'lParams')

  const lineVertex = Fn(() => {
    const pos = positionGeometry
    const delta = aDirLen.xyz.mul(aDirLen.w)
    lWarm.assign(edgeLight(aStart.add(delta.mul(pos.x))).w)
    const v0 = cameraViewMatrix.mul(vec4(aStart, 1.0)).toVar()
    const v1 = cameraViewMatrix.mul(vec4(aStart.add(delta), 1.0)).toVar()
    const nearZ = float(-0.12)
    const t0 = float(0).toVar()
    const t1 = float(1).toVar()
    const out = vec4(2.0, 2.0, 2.0, 1.0).toVar()
    If(v0.z.greaterThan(nearZ).and(v1.z.greaterThan(nearZ)).not(), () => {
      If(v0.z.greaterThan(nearZ), () => {
        const k = v0.z.sub(nearZ).div(v0.z.sub(v1.z)).toVar()
        v0.assign(mix(v0, v1, k))
        t0.assign(k)
      })
      If(v1.z.greaterThan(nearZ), () => {
        const k = v1.z.sub(nearZ).div(v1.z.sub(v0.z)).toVar()
        v1.assign(mix(v1, v0, k))
        t1.assign(float(1).sub(k))
      })
      const c0 = cameraProjectionMatrix.mul(v0).toVar()
      const c1 = cameraProjectionMatrix.mul(v1).toVar()
      const hv = u.viewport.mul(0.5)
      const s0 = c0.xy.div(c0.w).mul(hv)
      const s1 = c1.xy.div(c1.w).mul(hv)
      const d = s1.sub(s0).toVar()
      const L = length(d)
      const dir = select(L.greaterThan(1e-4), d.div(L), vec2(1.0, 0.0)).toVar()
      const nrm = vec2(dir.y.negate(), dir.x)
      const want = u.lineWidth.mul(u.viewport.y).div(1080.0).toVar()
      const wpx = max(want, 1.0).toVar()
      const hw = wpx.mul(0.5).add(1.0).toVar()
      const first = pos.x.lessThan(0.5)
      const c = select(first, c0, c1).toVar()
      out.assign(vec4(c.xy.add(nrm.mul(pos.y).mul(hw).div(hv).mul(c.w)), c.z, c.w))
      lAlong.assign(select(first, t0, t1))
      lSide.assign(pos.y.mul(hw))
      lWidthPx.assign(wpx)
      lFade.assign(clamp(want, 0.0, 1.0))
      lViewZ.assign(select(first, v0.z, v1.z).negate())
    })
    return out
  })

  const lineFragment = Fn(() => {
    const across = float(1).sub(
      smoothstep(lWidthPx.mul(0.5).sub(0.5), lWidthPx.mul(0.5).add(0.5), abs(lSide)),
    )
    const ends = smoothstep(0.0, 0.08, lAlong).mul(float(1).sub(smoothstep(0.92, 1.0, lAlong)))
    const head = fract(u.flowTime.mul(lParams.y).add(lParams.z))
    const behind = fract(head.sub(lAlong))
    const pulse = select(lParams.y.greaterThan(0.001), exp(behind.mul(-7.0)), float(0))
    const baseI = sin(u.time.mul(0.7).add(lParams.z.mul(20.0)))
      .mul(0.5)
      .add(0.5)
      .mul(0.65)
      .add(0.35)
    const I = lParams.x
      .mul(baseI.mul(0.18).add(pulse.mul(0.75)))
      .mul(ends)
      .mul(across)
      .mul(lFade)
      .mul(u.lineIntensity)
    const warmth = clamp(max(lParams.w, lWarm.mul(0.6)), 0.0, 1.0)
    const col = mix(u.highlight, u.core, warmth)
      .mul(I)
      .mul(lWarm.mul(0.6).add(1.0))
      .mul(fogFactor(lViewZ))
      .mul(smoothstep(1.6, 3.2, lViewZ))
    return vec4(col, 0.0)
  })

  // ——— POINT_VERT / POINT_FRAG: square sparks as screen-sized instanced quads ———
  const pViewZ = varyingProperty('float', 'pViewZ')
  const pSizeFade = varyingProperty('float', 'pSizeFade')
  const pWarm = varyingProperty('float', 'pWarm')
  const pCoord = varying(positionGeometry.xy, 'pCoord')
  const aPos = attribute('aPos', 'vec3')
  const ptParams = varying(attribute('aParams', 'vec4'), 'ptParams')

  const pointVertex = Fn(() => {
    const prm = attribute('aParams', 'vec4')
    const sd = prm.y
    const p = aPos
      .add(
        vec3(
          sin(u.driftTime.mul(0.21).add(sd.mul(6.28))),
          sin(u.driftTime.mul(0.17).add(sd.mul(12.1))),
          sin(
            u.driftTime
              .mul(0.19)
              .add(sd.mul(4.7))
              .add(Math.PI / 2),
          ),
        ).mul(0.12),
      )
      .toVar()
    pWarm.assign(edgeLight(p).w)
    const mv = cameraViewMatrix.mul(vec4(p, 1.0)).toVar()
    const vz = mv.z.negate().toVar()
    pViewZ.assign(vz)
    const px = prm.x
      .mul(u.viewport.y.div(1080.0))
      .mul(float(5.5).div(max(vz, 0.1)))
      .toVar()
    const fade = clamp(px, 0.0, 1.0)
    pSizeFade.assign(fade.mul(fade))
    const size = clamp(px, 1.0, 48.0)
    const c = cameraProjectionMatrix.mul(mv).toVar()
    // corners are -0.5..0.5: offset by `size` pixels in total
    const off = positionGeometry.xy.mul(size).mul(2.0).div(u.viewport).mul(c.w)
    return vec4(c.xy.add(off), c.z, c.w)
  })

  const pointFragment = Fn(() => {
    const d = max(abs(pCoord.x), abs(pCoord.y))
    const m = float(1).sub(smoothstep(0.3, 0.5, d))
    const tw = sin(
      u.time.mul(fract(ptParams.y.mul(7.3)).mul(2.0).add(1.0)).add(ptParams.y.mul(40.0)),
    )
      .mul(0.45)
      .add(0.55)
    const warmth = clamp(max(ptParams.z, pWarm.mul(0.7)), 0.0, 1.0)
    const col = mix(u.highlight, u.core, warmth)
      .mul(ptParams.w)
      .mul(tw)
      .mul(m)
      .mul(pSizeFade)
      .mul(u.particleIntensity)
      .mul(pWarm.mul(0.8).add(1.0))
      .mul(fogFactor(pViewZ))
    return vec4(col, 0.0)
  })

  // ——— HAZE: camera-facing billboards with fbm ———
  const hCenter = attribute('aCenter', 'vec3')
  const hParamsA = attribute('aParams', 'vec4')
  const hazePosition = hCenter.add(
    u.camRight.mul(positionGeometry.x).add(u.camUp.mul(positionGeometry.y)).mul(hParamsA.x),
  )
  const hUv = varying(positionGeometry.xy, 'hUv')
  const hParams = varying(hParamsA, 'hParams')

  const fbm = Fn(([p0]: N[]) => {
    const p = vec3(p0).toVar()
    const sum = float(0).toVar()
    const amp = float(0.5).toVar()
    Loop(3, () => {
      sum.addAssign(amp.mul(vnoise(p)))
      p.assign(p.mul(2.03).add(vec3(1.7, 9.2, 3.1)))
      amp.mulAssign(0.5)
    })
    return sum.mul(1.14)
  }).setLayout({ name: 'dcFbm', type: 'float', inputs: [{ name: 'p0', type: 'vec3' }] })

  const hazeFragment = Fn(() => {
    const viewZ = positionView.z.negate().toVar()
    const r = length(hUv).mul(2.0).toVar()
    const fall0 = float(1).sub(smoothstep(0.0, 1.0, r))
    const fall = fall0.mul(fall0).toVar()
    Discard(fall.lessThan(0.001))
    const warm = fmod(hParams.z, 2.0).greaterThan(0.5)
    If(hParams.z.greaterThan(1.5), () => {
      fall.mulAssign(smoothstep(0.22, 0.5, r)) // ring: keep the centre dark
    })
    const q = positionWorld
      .mul(select(warm, float(1.2), float(0.6)))
      .add(vec3(0.0, u.time.mul(0.04), u.time.mul(0.03)))
      .add(hParams.y.mul(7.0))
    const n = smoothstep(0.28, 0.85, fbm(q))
    const col = select(warm, vec3(u.core), vec3(u.haze))
      .mul(n)
      .mul(fall)
      .mul(hParams.w)
      .mul(u.hazeAmount)
      .mul(fogFactor(viewZ))
    return vec4(col, 0.0)
  })

  // ——— Materials ———
  const solid = new THREE.MeshBasicNodeMaterial()
  solid.positionNode = boxPosition
  solid.fragmentNode = solidFragment()
  solid.blending = THREE.CustomBlending
  solid.blendEquation = THREE.AddEquation
  solid.blendSrc = THREE.OneFactor
  solid.blendDst = THREE.OneMinusSrcAlphaFactor
  solid.blendSrcAlpha = THREE.OneFactor
  solid.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  solid.depthTest = true
  solid.depthWrite = true
  solid.toneMapped = false

  const additive = (m: THREE.MeshBasicNodeMaterial) => {
    m.transparent = true
    m.depthTest = true
    m.depthWrite = false
    m.blending = THREE.CustomBlending
    m.blendEquation = THREE.AddEquation
    m.blendSrc = THREE.OneFactor
    m.blendDst = THREE.OneFactor
    m.blendSrcAlpha = THREE.ZeroFactor
    m.blendDstAlpha = THREE.OneFactor
    m.toneMapped = false
    return m
  }

  const glow = additive(new THREE.MeshBasicNodeMaterial())
  glow.positionNode = boxPosition
  glow.fragmentNode = glowFragment()
  glow.side = THREE.DoubleSide

  const lines = additive(new THREE.MeshBasicNodeMaterial())
  lines.vertexNode = lineVertex()
  lines.fragmentNode = lineFragment()
  lines.side = THREE.DoubleSide

  const points = additive(new THREE.MeshBasicNodeMaterial())
  points.vertexNode = pointVertex()
  points.fragmentNode = pointFragment()
  points.side = THREE.DoubleSide

  const haze = additive(new THREE.MeshBasicNodeMaterial())
  haze.positionNode = hazePosition
  haze.fragmentNode = hazeFragment()
  haze.side = THREE.DoubleSide

  return { solid, glow, lines, points, haze }
}

export type Materials = ReturnType<typeof createMaterials>

/** Glyph atlas for the binary code: '0' in the left half, '1' in the right. */
export function createGlyphAtlas(maxAnisotropy: number): THREE.CanvasTexture {
  const cw = 128
  const ch = 192
  const canvas = document.createElement('canvas')
  canvas.width = cw * 2
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(ch * 0.82)}px "Courier New", Courier, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('0', cw * 0.5, ch * 0.53)
    ctx.fillText('1', cw * 1.5, ch * 0.53)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = Math.min(8, maxAnisotropy)
  tex.generateMipmaps = true
  return tex
}
