/**
 * Plasma Globe - port of Adam Chernick's Codevember 2026 day 21 "Bolt"
 * (Plasma) from React Three Fiber to a plain three.js scene (see
 * ./definition.ts for credit).
 *
 *   ./filaments.ts (the original CPU simulation, unchanged) lays out every
 *   filament as camera-facing strips each frame  ->  drawn twice from one
 *   buffer (white-hot line + wide gas halo)  ->  splashes and end-on dots  ->
 *   electrode  ->  glass (reflections, splashes, hand flare, rim, prints,
 *   bubbles, gas haze)  ->  aura  ->  bloom + ACES + vignette
 *
 * Porting notes:
 * - The original draws the globe in an overlay pass over a lit room and hides
 *   overlay pixels behind the room's depth (`step(sceneZ, positionView.z)`).
 *   Here there is no room geometry, so that test is dropped; the electrode
 *   still hides filaments behind it (`beforeCore`).
 * - The HDRI rooms are replaced by a small procedural room (`roomAt`), so no
 *   assets are needed; the ghost pass (filaments seen bent through the thick
 *   rim), the dust motes, IRL Hands and the sound are left out.
 * - The shader builders read per-scene uniforms instead of module globals, so
 *   two instances never share state. Helpers are plain JS builders (no
 *   `setLayout`), since several materials read the same uniforms
 *   (docs/known-issues.md).
 * - Contacts: slot 0 is the audio "touch", slot 1 the mouse.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  acesFilmicToneMapping,
  atan,
  attribute,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  luminance,
  max,
  mix,
  mx_noise_float,
  normalize,
  pass,
  positionGeometry,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  sqrt,
  sRGBTransferOETF,
  step,
  time,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'

import type {
  ParamValues,
  SceneContext,
  SceneFrame,
  SceneInstance,
  ScenePointerEvent,
} from '../../types'
import {
  CONTACTS,
  CORE,
  GLASS,
  INNER,
  type Plasma,
  type QualityTier,
  createPlasma,
} from './filaments'

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

// The gases a globe can be filled with (from the original): trunk, tips and the white-hot core.
const GASES = {
  classic: { inner: '#7488ff', outer: '#ff38b4', core: '#eceeff' },
  neon: { inner: '#ff6a3a', outer: '#ff2a1a', core: '#ffe0c0' },
  argon: { inner: '#9466ff', outer: '#d26cff', core: '#f2e6ff' },
  xenon: { inner: '#4f86ff', outer: '#58d6ff', core: '#e4f6ff' },
} as const
type Gas = keyof typeof GASES

const AUDIO = 0
const MOUSE = 1
const TARGET = new THREE.Vector3(0, -0.04, 0)
const WORLD_UP = new THREE.Vector3(0, 1, 0)

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function makeGlow() {
  return {
    inner: uniform(new THREE.Color(GASES.classic.inner)),
    outer: uniform(new THREE.Color(GASES.classic.outer)),
    core: uniform(new THREE.Color(GASES.classic.core)),
    power: uniform(1),
    surge: uniform(0),
    gas: uniform(0.5),
    exposure: uniform(1),
    mirror: uniform(0.8),
    aura: uniform(1),
  }
}
type Glow = ReturnType<typeof makeGlow>

// The room's grading (the original's "bar" room numbers).
const ROOM = { behind: 0.22, cool: 0.15, peak: 0.6 }
const COOL = vec3(0.62, 0.74, 1.0)

/**
 * A small procedural room standing in for the original's HDRIs: a dim warm
 * floor-to-ceiling gradient, a warm lamp, a cool window and a ceiling strip,
 * so the glass has lights to catch.
 */
function roomAt(d: N): N {
  const base = mix(
    vec3(0.003, 0.003, 0.005),
    vec3(0.025, 0.02, 0.018),
    clamp(d.y.mul(0.5).add(0.5), 0, 1),
  )
  const lamp = vec3(1.0, 0.72, 0.42)
    .mul(4)
    .mul(smoothstep(0.985, 0.997, dot(d, vec3(-0.55, 0.42, 0.72))))
  const window = vec3(0.5, 0.66, 1.0)
    .mul(1.6)
    .mul(smoothstep(0.95, 0.985, dot(d, vec3(0.84, 0.22, -0.49))))
  const strip = vec3(1.0, 0.96, 0.9)
    .mul(1.2)
    .mul(smoothstep(0.95, 0.995, d.y))
    .mul(float(1).sub(smoothstep(0.1, 0.25, abs(d.x))))
  const hdr = base.add(lamp).add(window).add(strip)
  return mix(hdr, COOL.mul(luminance(hdr)), ROOM.cool)
}

// A filament's light across its width: a near-white core clipping under bloom inside a soft sheath.
function filamentLight(g: Glow, u: N, info: N, gain: N): N {
  const bright = info.y
  const along = info.z
  const heat = info.w
  const core = exp(u.mul(u).mul(-1 / (2 * 0.16 * 0.16)))
  const sheath = exp(u.mul(u).mul(-1 / (2 * 0.45 * 0.45)))
  const tint = mix(g.inner, g.outer, smoothstep(0.55, 0.97, along))
  const hot = mix(
    mix(g.core, tint, smoothstep(0.6, 1, along).mul(0.55)),
    vec3(1, 0.97, 1),
    heat.mul(0.6),
  )
  return hot
    .mul(core.mul(mix(float(3.4), float(6), heat)))
    .add(tint.mul(sheath.mul(0.6)))
    .mul(bright)
    .mul(gain)
}

// 1 where the electrode is not in the way.
function beforeCore(): N {
  const d = positionWorld.sub(cameraPosition)
  const far = length(d)
  const dir = d.div(far)
  const along = dot(cameraPosition.negate(), dir)
  const miss = dot(cameraPosition, cameraPosition).sub(along.mul(along))
  const into = sqrt(max(float(CORE * CORE).sub(miss), float(0)))
  const hit = along.sub(into)
  return float(1).sub(step(float(1e-5), into).mul(step(hit, far.sub(0.002))))
}

function additive(side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side,
    blending: THREE.AdditiveBlending,
  })
}

function buildFilaments(plasma: Plasma, g: Glow) {
  const make = (scale: number) => {
    const material = additive(THREE.DoubleSide)
    material.positionNode = positionGeometry.add(attribute('aSide', 'vec3').mul(scale))
    const mesh = new THREE.Mesh(plasma.geometry, material)
    mesh.frustumCulled = false
    return { material, mesh }
  }
  const line = make(1)
  const halo = make(3.2)
  const info: N = attribute('aInfo', 'vec4')
  const u = info.x
  const shown = beforeCore()
  const nearCore = float(1)
    .sub(
      float(1)
        .sub(g.exposure)
        .mul(1.4)
        .mul(float(1).sub(smoothstep(0.1, 0.32, length(positionWorld)))),
    )
    .max(0.25)
  line.material.colorNode = vec4(filamentLight(g, u, info, shown.mul(g.exposure).mul(nearCore)), 1)
  const tint = mix(g.inner, g.outer, smoothstep(0.5, 0.97, info.z))
  const h = exp(u.mul(u).mul(-4))
    .sub(exp(float(-4)))
    .max(0)
  halo.material.colorNode = vec4(
    tint.mul(
      h
        .mul(info.y.min(2))
        .mul(attribute('aHalo', 'float'))
        .mul(0.05)
        .mul(shown)
        .mul(g.exposure.mul(g.exposure)),
    ),
    1,
  )
  halo.mesh.renderOrder = 3
  line.mesh.renderOrder = 4
  return { meshes: [halo.mesh, line.mesh], materials: [line.material, halo.material] }
}

function buildSplashes(plasma: Plasma, g: Glow) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const count = plasma.splashes.length / 4
  const at = new THREE.InstancedBufferAttribute(plasma.splashes, 4).setUsage(THREE.DynamicDrawUsage)
  quad.setAttribute('aSplash', at)
  const material = additive(THREE.DoubleSide)
  const mesh = new THREE.InstancedMesh(quad, material, count)
  const identity = new THREE.Matrix4()
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, identity)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  const splash: N = attribute('aSplash', 'vec4')
  const n = normalize(splash.xyz)
  const across = normalize(cross(n, vec3(0.31, 0.95, 0.05)))
  const up = cross(n, across)
  const far = smoothstep(0.1, -0.6, dot(n, normalize(cameraPosition)))
  const size = float(0.035).mul(far.mul(1.6).add(1))
  material.positionNode = n
    .mul(INNER * 0.998)
    .add(across.mul(positionGeometry.x.mul(size.mul(2))))
    .add(up.mul(positionGeometry.y.mul(size.mul(2))))
  const r = uv().sub(0.5).length().mul(2)
  const core = exp(r.mul(r).mul(-60))
  const halo = exp(r.mul(r).mul(-7))
    .sub(exp(float(-7)))
    .max(0)
  const light = vec3(1, 0.9, 0.97)
    .mul(core.mul(1.4).mul(float(1).sub(far)))
    .add(g.outer.mul(halo.mul(0.7)))
    .mul(splash.w)
    .div(far.mul(1.6).add(1).pow(2))
  material.colorNode = vec4(light, 1)
  return { mesh, material, quad, at }
}

function buildDots(plasma: Plasma, g: Glow) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const count = plasma.dots.length / 4
  const at = new THREE.InstancedBufferAttribute(plasma.dots, 4).setUsage(THREE.DynamicDrawUsage)
  quad.setAttribute('aDot', at)
  const material = additive()
  const mesh = new THREE.InstancedMesh(quad, material, count)
  const identity = new THREE.Matrix4()
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, identity)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  const d: N = attribute('aDot', 'vec4')
  const centre = d.xyz
  const toEye = normalize(cameraPosition.sub(centre))
  const right = normalize(cross(vec3(0, 1, 0), toEye))
  const up = cross(toEye, right)
  const size = float(0.014)
  material.positionNode = centre
    .add(toEye.mul(0.004))
    .add(right.mul(positionGeometry.x.mul(size.mul(2))))
    .add(up.mul(positionGeometry.y.mul(size.mul(2))))
  const r = uv().sub(0.5).length().mul(2)
  const core = exp(r.mul(r).mul(-14))
  const soft = exp(r.mul(r).mul(-4))
    .sub(exp(float(-4)))
    .max(0)
  const light = mix(g.core, vec3(1), 0.4)
    .mul(core.mul(2.2))
    .add(g.inner.mul(soft.mul(0.6)))
    .mul(d.w)
  material.colorNode = vec4(light.mul(g.exposure), 1)
  return { mesh, material, quad, at }
}

// Where three fingerprints have been left on the glass, and which way each lies.
const PRINTS = [
  { at: new THREE.Vector3(0.42, 0.3, 0.86), turn: 0.6 },
  { at: new THREE.Vector3(-0.5, -0.12, 0.86), turn: -0.9 },
  { at: new THREE.Vector3(-0.3, 0.2, -0.93), turn: 2.1 },
].map((p) => ({ ...p, at: p.at.normalize() }))

function buildGlass(plasma: Plasma, g: Glow) {
  const geometry = new THREE.SphereGeometry(GLASS, 160, 120)
  const tips: N = uniformArray(plasma.tips, 'vec4')
  const hands: N = uniformArray(plasma.hands, 'vec4')
  const build = (front: boolean) => {
    const m = additive(front ? THREE.FrontSide : THREE.BackSide)
    const mesh = new THREE.Mesh(geometry, m)
    mesh.frustumCulled = false
    mesh.renderOrder = front ? 7 : 1
    m.colorNode = Fn(() => {
      const n = normalize(positionWorld)
      const d = normalize(positionWorld.sub(cameraPosition))
      const cosine = abs(dot(n, d))
      // A thin shell reflects twice, front face and back: about 2F / (1 + F) of Schlick's F.
      const f = float(0.04).add(float(0.96).mul(pow(float(1).sub(cosine), 5)))
      const shell = f.mul(2).div(f.add(1))

      // Where each filament touches: a small hot splash and a wider bloom; soft and round on the far wall.
      const nv = normalize(positionWorld)
      const toMiddle = cameraPosition.negate()
      const reach = dot(toMiddle, d)
      const passes = sqrt(max(dot(toMiddle, toMiddle).sub(reach.mul(reach)), float(0)))
      const into = sqrt(max(float(INNER * INNER).sub(passes.mul(passes)), float(0)))
      const onInner = normalize(
        cameraPosition.add(d.mul(front ? reach.sub(into) : reach.add(into))),
      )
      const ni = mix(n, onInner, step(passes, float(INNER)))
      let tight: N = float(0)
      let centre: N = float(0)
      let soft: N = float(0)
      let wideSum: N = float(0)
      for (let i = 0; i < plasma.limit; i++) {
        const tip: N = tips.element(i)
        const offV = float(1).sub(dot(nv, tip.xyz))
        soft = soft.add(
          (front
            ? exp(offV.mul(-160)).mul(0.12)
            : exp(offV.mul(-420))
                .mul(0.45)
                .add(exp(offV.mul(-90)).mul(0.12))
          ).mul(tip.w),
        )
        if (front) {
          wideSum = wideSum.add(exp(offV.mul(-40)).mul(tip.w))
          const off = float(1).sub(dot(ni, tip.xyz))
          tight = tight.add(exp(off.mul(-2200)).mul(1.1).mul(tip.w))
          centre = centre.add(exp(off.mul(-12000)).mul(1.4).mul(tip.w))
        }
      }
      const atVertex: N = varying(
        vec4(soft, wideSum, front ? mx_noise_float(nv.mul(vec3(3, 9, 3))) : float(0), 0),
      )
      const spots = front ? tight.add(atVertex.x) : atVertex.x
      const wideLight = atVertex.y
      let light: N = mix(g.outer, g.core, 0.2)
        .mul(spots)
        .add(vec3(1, 0.9, 0.97).mul(centre))

      // Under each hand: a white-hot flare, a pink ring and a wide glow that fades slowly after letting go.
      let warm: N = float(0)
      for (let k = 0; k < CONTACTS; k++) {
        const hand: N = hands.element(k)
        const off = float(1).sub(dot(n, hand.xyz))
        light = light.add(
          vec3(1, 0.95, 1)
            .mul(exp(off.mul(-9000)).mul(6))
            .add(mix(g.outer, vec3(1, 0.85, 0.95), 0.3).mul(exp(off.mul(-1200)).mul(1.6)))
            .add(g.outer.mul(exp(off.mul(-150)).mul(0.45)))
            .mul(hand.w),
        )
        warm = warm.add(exp(off.mul(-60)).mul(hand.w))
      }
      const wash = g.surge.mul(float(0.006).add(pow(float(1).sub(cosine), 2).mul(0.025)))
      light = light.add(g.outer.mul(warm.mul(front ? 0.14 : 0.08).add(wash)))

      // The room in the glass; the hand-blown surface wavers it a little.
      const waver = vec3(
        sin(n.y.mul(31).add(n.x.mul(7))),
        sin(n.z.mul(27).add(n.y.mul(9))),
        sin(n.x.mul(29).add(n.z.mul(11))),
      ).mul(0.006)
      const bent = normalize(n.add(waver))
      const r = reflect(d, front ? bent : bent.negate())
      const roomSeen = roomAt(r)
      const mirrored = roomSeen
        .mul(shell)
        .mul(g.mirror)
        .mul(front ? 1 : 0.4)
      light = light.add(mirrored.div(luminance(mirrored).mul(ROOM.peak).add(1)))

      if (front) {
        const toCentre = cameraPosition.negate()
        const along = dot(toCentre, d)
        const miss = sqrt(max(dot(toCentre, toCentre).sub(along.mul(along)), float(0)))
        const plasmaTint = mix(g.inner, g.outer, 0.6)
        // Both surfaces' edges, lit from inside where filaments meet the glass nearby.
        const outerEdge = pow(float(1).sub(cosine), 12).mul(0.4)
        const innerEdge = exp(miss.sub(INNER).div(0.005).pow(2).negate()).mul(0.2)
        const nearby = wideLight.mul(0.25).add(warm.mul(0.6)).add(0.15)
        light = light.add(plasmaTint.mul(outerEdge.add(innerEdge).mul(nearby).mul(g.power)))

        // Fingerprints: whorls of fine ridges, seen only where something bright lights them.
        let prints: N = float(0)
        for (const p of PRINTS) {
          const across = new THREE.Vector3()
            .crossVectors(p.at, new THREE.Vector3(0, 1, 0))
            .normalize()
            .applyAxisAngle(p.at, p.turn)
          const up = new THREE.Vector3().crossVectors(across, p.at)
          const x = dot(n, vec3(across.x, across.y, across.z))
          const y = dot(n, vec3(up.x, up.y, up.z)).mul(0.78)
          const rr = length(vec2(x, y))
          const ridges = sin(
            rr
              .mul(1100)
              .add(atan(y, x).mul(1.5))
              .add(sin(x.mul(90)).mul(1.2)),
          )
            .mul(0.5)
            .add(0.5)
          const pad = exp(rr.div(0.075).pow(4).negate()).mul(
            step(float(0.3), dot(n, vec3(p.at.x, p.at.y, p.at.z))),
          )
          prints = prints.add(ridges.mul(pad).mul(0.8).add(pad.mul(0.2)))
        }
        const smear = atVertex.z.mul(0.5).add(0.5)
        const catchLight = luminance(roomSeen)
          .mul(1.2)
          .add(wideLight.mul(0.05))
          .add(warm.mul(0.5))
          .add(0.03)
        light = light.add(
          mix(vec3(0.8, 0.82, 0.9), plasmaTint, 0.5).mul(
            prints.mul(0.1).add(smear.mul(0.015)).mul(catchLight),
          ),
        )

        // Tiny bubbles in the glass.
        const cells = n.mul(70)
        const cell = floor(cells)
        const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453))
        const middle = cell.add(0.5).add(
          vec3(fract(h.mul(13.1)), fract(h.mul(7.7)), fract(h.mul(3.3)))
            .sub(0.5)
            .mul(0.6),
        )
        const dist = length(cells.sub(middle))
        const size = h.mul(0.12).add(0.05)
        const bubble = step(0.992, h).mul(float(1).sub(smoothstep(size.mul(0.4), size, dist)))
        light = light.add(
          vec3(0.9, 0.9, 1).mul(
            bubble.mul(luminance(roomSeen).mul(2).add(wideLight.mul(0.08)).add(0.05)),
          ),
        )

        // The gas: light from a column as deep as the ray's path, thickest round the electrode.
        const chord = sqrt(max(float(1).sub(miss.mul(miss)), float(0)))
        const haze = exp(miss.mul(miss).mul(-1 / (2 * 0.13 * 0.13)))
          .mul(0.04)
          .add(exp(miss.mul(miss).mul(-1 / (2 * 0.42 * 0.42))).mul(0.035))
          .add(chord.mul(0.018))
        const gasColour = mix(g.inner, g.core, exp(miss.mul(-14)).mul(0.5))
        light = light.add(
          mix(gasColour, g.outer, g.surge.mul(0.35)).mul(
            haze.mul(g.gas).mul(g.power.mul(0.8).add(g.surge.mul(0.2))),
          ),
        )
      }
      return vec4(light, 1)
    })()
    return { mesh, material: m }
  }
  const back = build(false)
  const front = build(true)
  return { geometry, meshes: [back.mesh, front.mesh], materials: [back.material, front.material] }
}

function buildElectrode(plasma: Plasma, g: Glow) {
  const geometry = new THREE.SphereGeometry(CORE, 96, 64)
  const material = additive()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  const roots: N = uniformArray(plasma.roots, 'vec4')
  material.colorNode = Fn(() => {
    const n = normalize(positionWorld)
    const toEye = normalize(cameraPosition.sub(positionWorld))
    const facing = max(dot(n, toEye), float(0))
    const limb = float(1).sub(facing)
    const t: N = time
    const spin = t.mul(0.12)
    const turned = vec3(
      n.x.mul(cos(spin)).sub(n.z.mul(sin(spin))),
      n.y,
      n.x.mul(sin(spin)).add(n.z.mul(cos(spin))),
    )
    const veins = abs(mx_noise_float(turned.mul(5)))
    const mottle = mx_noise_float(turned.mul(11).add(vec3(0, t.mul(0.08), 0)))
      .mul(0.5)
      .add(0.5)
    const cells = turned.mul(30)
    const id = floor(cells)
    const h = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))).mul(43758.5453))
    const speck = float(1)
      .sub(smoothstep(0.1, 0.28, length(fract(cells).sub(0.5))))
      .mul(step(0.6, h))
      .mul(
        sin(t.mul(h.mul(20).add(6)).add(h.mul(40)))
          .mul(0.5)
          .add(0.5),
      )
    // The feet: a white-hot point where each filament leaves, a flared patch, a wider pool; and a wrap over the edge.
    const wrapped = normalize(n.sub(toEye.mul(0.9)))
    let foot: N = float(0)
    let patch: N = float(0)
    let pools: N = float(0)
    let wrap: N = float(0)
    for (let i = 0; i < plasma.limit; i++) {
      const root: N = roots.element(i)
      const off = float(1).sub(dot(n, root.xyz))
      foot = foot.add(exp(off.mul(-1400)).mul(root.w))
      patch = patch.add(exp(off.mul(-220)).mul(root.w))
      pools = pools.add(exp(off.mul(-30)).mul(root.w))
      wrap = wrap.add(exp(float(1).sub(dot(wrapped, root.xyz)).mul(-12)).mul(root.w))
    }
    const warmTone = mix(g.outer, vec3(1, 0.3, 0.1), 0.55)
    const veined = float(1).sub(smoothstep(0.02, 0.12, veins))
    const inside = mix(
      warmTone.mul(0.1),
      warmTone.mul(0.65),
      mottle.mul(0.55).add(veined.mul(0.45)),
    ).mul(facing.mul(0.75).add(0.25))
    const rim = mix(warmTone, g.core, 0.5).mul(pow(limb, 3).mul(1.1))
    const f = float(0.04).add(float(0.96).mul(pow(limb, 5)))
    const lumpy = normalize(
      n.add(
        vec3(
          mx_noise_float(turned.mul(7)),
          mx_noise_float(turned.mul(7).add(13)),
          mx_noise_float(turned.mul(7).add(29)),
        ).mul(0.18),
      ),
    )
    const caught = roomAt(reflect(toEye.negate(), lumpy)).mul(g.mirror).mul(f.add(0.06)).mul(2.2)
    const caughtSoft = caught.div(luminance(caught).mul(0.4).add(1))
    const wisp = float(1).sub(
      smoothstep(0, 0.035, abs(mx_noise_float(turned.mul(9).add(vec3(0, t.mul(0.25), 0))))),
    )
    const body = inside
      .add(mix(warmTone, vec3(1, 0.85, 0.9), 0.5).mul(wisp.mul(0.55)))
      .add(vec3(1, 0.5, 0.3).mul(speck.mul(1.3)))
      .add(mix(warmTone, g.core, 0.3).mul(pools.mul(0.18)))
      .add(mix(g.inner, g.core, 0.6).mul(patch.mul(1.4)))
      .add(vec3(1, 0.96, 1).mul(foot.mul(3)))
      .add(mix(g.inner, g.core, 0.5).mul(wrap.mul(pow(limb, 2)).mul(0.5)))
      .add(rim)
      .add(caughtSoft)
    return vec4(
      clamp(body, 0, 4)
        .mul(g.power.mul(0.8).add(g.surge.mul(0.3)).add(0.2))
        .mul(g.exposure),
      1,
    )
  })()
  return { mesh, material, geometry }
}

// The globe's light scattered toward the eye by a faint haze in the room (closed form of 1/r² along a line).
function buildAura(g: Glow) {
  const geometry = new THREE.SphereGeometry(30, 48, 24)
  const material = additive(THREE.BackSide)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 0
  const d = normalize(positionWorld.sub(cameraPosition))
  const toCentre = cameraPosition.negate()
  const along = dot(toCentre, d)
  const miss = sqrt(max(dot(toCentre, toCentre).sub(along.mul(along)), float(1e-4)))
  // No room geometry here: the line runs to a far wall 16 units out.
  const stop = float(16)
  const scattered = atan(stop.sub(along), miss).add(atan(along, miss)).div(miss)
  const outside = smoothstep(0.95, 1.25, miss)
  const tint = mix(g.inner, g.outer, 0.45)
  const globe = tint.mul(
    scattered
      .mul(outside)
      .mul(exp(miss.mul(-0.9)))
      .mul(0.02)
      .mul(g.power.add(g.surge.mul(0.6)))
      .mul(g.aura),
  )
  material.colorNode = vec4(globe, 1)
  return { mesh, material, geometry }
}

// Room behind the globe, graded as the original grades its HDRI backdrop, plus the globe's violet spill.
function buildBackdrop(g: Glow, bg: N) {
  const geometry = new THREE.SphereGeometry(40, 64, 32)
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false })
  const d = normalize(positionWorld.sub(cameraPosition))
  const dim = roomAt(d).mul(ROOM.behind).mul(0.35)
  const behind = dim.div(luminance(dim).mul(2.2).add(1))
  const painted = mix(g.inner, g.outer, 0.4)
    .mul(g.power.add(g.surge.mul(0.6)))
    .mul(0.012)
    .mul(g.aura)
  material.colorNode = vec4(bg.add(behind).add(painted), 1)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -2
  return { mesh, material, geometry }
}

/** Where a ray from the eye first meets the glass, or null. */
function onGlass(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 | null {
  const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), GLASS), out)
  return hit ? out.normalize() : null
}

class PlasmaGlobe implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly canvas: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100)
  private readonly plasma: Plasma
  private readonly glow = makeGlow()
  private readonly bg = uniform(new THREE.Color(0, 0, 0))
  private readonly post: THREE.PostProcessing
  private readonly bloomNode: N
  private readonly post_ = {
    exposure: uniform(1.05),
    vignette: uniform(0.6),
  }
  private readonly disposables: { dispose(): void }[] = []
  private readonly splashAttr: THREE.InstancedBufferAttribute
  private readonly dotAttr: THREE.InstancedBufferAttribute

  private width: number
  private height: number
  private yaw = 0
  private dragPitch = 0
  private readonly lens = { pixel: 0.001, focus: 4, defocus: 0.03 }
  private readonly pointerState = {
    id: -1,
    mode: 'none' as 'none' | 'touch' | 'orbit',
    x: 0,
    y: 0,
  }
  private readonly ndc = new THREE.Vector2()
  private readonly raycaster = new THREE.Raycaster()
  private readonly hit = new THREE.Vector3()
  private readonly audioAt = new THREE.Vector3(0, 0, 1)
  private readonly audioTarget = new THREE.Vector3()
  private readonly basisRight = new THREE.Vector3()
  private readonly basisUp = new THREE.Vector3()
  private readonly gasColors = {
    inner: new THREE.Color(),
    outer: new THREE.Color(),
    core: new THREE.Color(),
  }

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    this.canvas = ctx.canvas
    this.width = ctx.width
    this.height = ctx.height
    const tier = String(ctx.params.quality ?? 'medium') as QualityTier
    this.plasma = createPlasma(['low', 'medium', 'high'].includes(tier) ? tier : 'medium')
    const g = this.glow

    const backdrop = buildBackdrop(g, this.bg)
    const aura = buildAura(g)
    const electrode = buildElectrode(this.plasma, g)
    const glass = buildGlass(this.plasma, g)
    const filaments = buildFilaments(this.plasma, g)
    const splashes = buildSplashes(this.plasma, g)
    const dots = buildDots(this.plasma, g)
    this.splashAttr = splashes.at
    this.dotAttr = dots.at
    this.scene.add(backdrop.mesh, aura.mesh, electrode.mesh, ...glass.meshes, ...filaments.meshes)
    this.scene.add(splashes.mesh, dots.mesh)
    this.disposables.push(
      backdrop.geometry,
      backdrop.material,
      aura.geometry,
      aura.material,
      electrode.geometry,
      electrode.material,
      glass.geometry,
      ...glass.materials,
      ...filaments.materials,
      this.plasma.geometry,
      splashes.quad,
      splashes.material,
      dots.quad,
      dots.material,
    )

    // Post: bloom on the HDR frame, ACES with exposure, vignette, sRGB encode (renderer settings untouched).
    this.post = new THREE.PostProcessing(this.renderer)
    this.post.outputColorTransform = false
    const scenePass = pass(this.scene, this.camera)
    const hdr: N = scenePass.getTextureNode('output').rgb
    this.bloomNode = bloom(vec4(hdr, 1), 0.5, 0.5, 1)
    const p = this.post_
    this.post.outputNode = Fn(() => {
      const lit = hdr.add(this.bloomNode.rgb)
      const mapped = acesFilmicToneMapping(lit, p.exposure)
      const r = uv().sub(0.5).length()
      const vig = float(1).sub(smoothstep(0.35, 0.85, r).mul(p.vignette))
      return vec4(sRGBTransferOETF(clamp(mapped.mul(vig), 0, 1)), 1)
    })()
    this.disposables.push(scenePass, this.bloomNode)
  }

  async init(p: Readonly<ParamValues>) {
    this.sync(p, 0, true)
    this.plasma.step(1 / 60, num(p.storm, 0.2), this.camera.position, this.lens)
    await this.renderer.compileAsync(this.scene, this.camera)
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  action(key: string) {
    if (key === 'resetView') {
      this.yaw = 0
      this.dragPitch = 0
    }
  }

  private toNdc(x: number, y: number) {
    const w = Math.max(this.canvas.clientWidth, 1)
    const h = Math.max(this.canvas.clientHeight, 1)
    return this.ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1)
  }

  private glassUnder(x: number, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.toNdc(x, y), this.camera)
    return onGlass(this.raycaster.ray, this.hit)
  }

  pointer(ev: ScenePointerEvent) {
    const ps = this.pointerState
    const c = this.plasma.contacts[MOUSE]!
    if (ev.type === 'down') {
      if (ps.mode !== 'none') return
      ps.id = ev.id
      ps.x = ev.x
      ps.y = ev.y
      const at = this.glassUnder(ev.x, ev.y)
      if (at) {
        ps.mode = 'touch'
        c.at.copy(at)
        c.pull = 1
        c.want = 1
        c.live = true
      } else ps.mode = 'orbit'
      return
    }
    if (ev.id !== ps.id) return
    if (ev.type === 'move') {
      if (ps.mode === 'touch') {
        const at = this.glassUnder(ev.x, ev.y)
        if (at) c.at.copy(at)
      } else if (ps.mode === 'orbit') {
        const h = Math.max(this.canvas.clientHeight, 1)
        this.yaw -= ((ev.x - ps.x) / h) * Math.PI
        this.dragPitch = THREE.MathUtils.clamp(this.dragPitch + ((ev.y - ps.y) / h) * 2, -1.2, 1.2)
      }
      ps.x = ev.x
      ps.y = ev.y
    } else {
      if (ps.mode === 'touch') {
        c.want = 0
        c.live = false
      }
      ps.mode = 'none'
      ps.id = -1
    }
  }

  private updateCamera(p: Readonly<ParamValues>, dt: number) {
    this.yaw += dt * num(p.orbitSpeed, 0.04) * ((Math.PI * 2 * 10) / 60)
    const pitch = THREE.MathUtils.clamp(
      num(p.camHeight, 0.05) * (Math.PI / 2) + this.dragPitch * 0.6,
      -1.3,
      1.3,
    )
    const dist = num(p.camDistance, 4.15)
    const cam = this.camera
    cam.position.set(
      TARGET.x + Math.sin(this.yaw) * Math.cos(pitch) * dist,
      TARGET.y + Math.sin(pitch) * dist,
      TARGET.z + Math.cos(this.yaw) * Math.cos(pitch) * dist,
    )
    cam.lookAt(TARGET)
    cam.fov = num(p.fov, 34)
    cam.aspect = this.width / Math.max(this.height, 1)
    cam.updateProjectionMatrix()
    this.lens.pixel =
      (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, this.height)
    this.lens.focus = cam.position.length() - 0.25
  }

  /**
   * The audio touch: a contact on the glass placed like a clock face as seen
   * from the camera (angle 0 = 12 o'clock, so the 12 notes land on the 12
   * hours), `touchReach` from the middle of the view (0, pointing at you) out
   * to the rim (1). Kept off dead-centre, where a bolt would be seen end-on.
   */
  private updateAudioTouch(p: Readonly<ParamValues>, dt: number) {
    const c = this.plasma.contacts[AUDIO]!
    const touch = num(p.touch, 0)
    const theta = num(p.touchAngle, 0) * Math.PI * 2
    const reach = THREE.MathUtils.clamp(num(p.touchReach, 0.7), 0, 1)
    const beta = (0.15 + reach * 0.8) * (Math.PI / 2)
    const cam = this.camera
    const toCam = this.audioTarget.copy(cam.position).sub(TARGET).normalize()
    const right = this.basisRight.crossVectors(WORLD_UP, toCam).normalize()
    const up = this.basisUp.crossVectors(toCam, right)
    const s = Math.sin(beta)
    this.audioTarget
      .multiplyScalar(Math.cos(beta))
      .addScaledVector(right, Math.sin(theta) * s)
      .addScaledVector(up, Math.cos(theta) * s)
      .normalize()
    // Slides over the glass rather than jumping, so a new note swings the bolt over.
    this.audioAt.lerp(this.audioTarget, 1 - Math.exp(-dt * 10)).normalize()
    const on = touch > 0.1
    c.at.copy(this.audioAt)
    c.pull = 1
    c.want = on ? Math.min(1, touch) : 0
    c.live = on
  }

  private sync(p: Readonly<ParamValues>, dt: number, snap = false) {
    const g = this.glow
    const gas = GASES[(String(p.gas) in GASES ? String(p.gas) : 'classic') as Gas]
    const hue = num(p.hueShift, 0)
    const k = snap ? 1 : 1 - Math.exp(-dt * 4)
    for (const key of ['inner', 'outer', 'core'] as const) {
      const want = this.gasColors[key].set(gas[key]).offsetHSL(hue, 0, 0)
      ;(g[key].value as THREE.Color).lerp(want, k)
    }
    const storm = num(p.storm, 0.2)
    g.gas.value = (0.55 + storm * 0.9) * num(p.gasGlow, 1)
    g.mirror.value = 0.8 * num(p.reflections, 1)
    g.aura.value = num(p.aura, 1)
    const camDist = num(p.camDistance, 4.15)
    g.exposure.value = 0.45 + 0.55 * THREE.MathUtils.smoothstep(camDist, 1.7, 3.8)
    ;(this.bg.value as THREE.Color).set(String(p.backgroundColor ?? '#000000'))
    this.post_.exposure.value = num(p.exposure, 1.05)
    this.post_.vignette.value = num(p.vignette, 0.6)
    this.bloomNode.strength.value = num(p.bloom, 0.5)
    this.bloomNode.threshold.value = num(p.bloomThreshold, 1)
  }

  update(frame: SceneFrame) {
    const { params: p } = frame
    const dt = (p.paused === true ? 0 : Math.min(frame.dt, 0.1)) * num(p.timeScale, 1)
    this.updateCamera(p, frame.dt)
    this.updateAudioTouch(p, frame.dt)
    this.sync(p, frame.dt)
    if (dt > 0) {
      const storm = num(p.storm, 0.2)
      this.plasma.step(dt, storm, this.camera.position, this.lens)
      const totals = this.plasma.totals
      const g = this.glow
      g.power.value +=
        (0.75 +
          0.25 * Math.min(1.4, totals.glow) +
          totals.surging * 0.2 -
          (g.power.value as number)) *
        (1 - Math.exp(-dt * 8))
      g.surge.value +=
        (totals.surge * Math.min(1, 0.5 + totals.held * 0.25) - (g.surge.value as number)) *
        (1 - Math.exp(-dt * 6))
      this.splashAttr.needsUpdate = true
      this.dotAttr.needsUpdate = true
    }
    this.post.render()
  }

  dispose() {
    this.post.dispose()
    for (const d of this.disposables) d.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new PlasmaGlobe(ctx)
  await scene.init(ctx.params)
  return scene
}
