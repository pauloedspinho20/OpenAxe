/**
 * Digital Core - TSL port of Sabo Sugi's three.js / GLSL scene (credit in
 * ./definition.ts). Layout:
 *
 *   generate.ts   procedural room / core / lines / sparks / haze (same RNG)
 *   materials.ts  node materials (ports of the GLSL chunks)
 *   post.ts       node post chain (DOF, smear, shafts, bloom, grade)
 *   scene.ts      this file: lifecycle, params -> uniforms, camera, edge lights
 *
 * Every speed param is integrated over time (orbit included), so audio
 * modulating a speed changes how fast things move, never jumps them.
 */
import * as THREE from 'three/webgpu'

import { emptyFeatures } from '../../audio/features'
import type { ParamValues, SceneContext, SceneFrame, SceneInstance } from '../../types'
import {
  buildCore,
  buildHaze,
  buildLines,
  buildParticles,
  buildRoom,
  type CoreEdge,
  type GeometryParams,
} from './generate'
import {
  createGlyphAtlas,
  createMaterials,
  createUniforms,
  type Materials,
  type Uniforms,
} from './materials'
import { buildPostChain, createPostUniforms, type PostUniforms } from './post'

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)

const COLOR_KEYS = [
  ['background', 'base', '#010409'],
  ['panel', 'panel', '#1f78b8'],
  ['glass', 'glass', '#3c94d6'],
  ['highlight', 'highlight', '#a8e8ff'],
  ['core', 'core', '#ff8526'],
  ['coreHot', 'coreHot', '#ffe2b8'],
  ['hazeColor', 'haze', '#164f80'],
  ['envLight', 'env', '#cfe4ff'],
] as const

const smoothstepJS = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

class DigitalCore implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly u: Uniforms
  private readonly pu: PostUniforms
  private readonly materials: Materials
  private readonly glyphs: THREE.CanvasTexture
  private readonly boxBase = new THREE.BoxGeometry(1, 1, 1)
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly edges: CoreEdge[]
  private readonly post: THREE.PostProcessing
  private chain: { output: N; bloom: N; nodes: N[] }
  private dofOn: boolean

  private sceneTime = 0
  private orbitTime = 0
  private shakeTime = 0
  private kickVel = 0
  private readonly color = new THREE.Color()
  private readonly hsl = { h: 0, s: 0, l: 0 }
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly quat = new THREE.Quaternion()
  private readonly offset = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly ndc = new THREE.Vector3()
  private readonly savedClear = new THREE.Color()

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    const p = ctx.params
    const geo: GeometryParams = {
      seed: Math.round(num(p.seed, 11)),
      coreDensity: num(p.coreDensity, 1),
      roomDepth: num(p.roomDepth, 1),
      blockDetail: num(p.blockDetail, 1),
      lineCount: num(p.lineCount, 220),
      particleCount: num(p.particleCount, 2600),
    }

    this.u = createUniforms()
    this.pu = createPostUniforms()
    let aniso = 8
    try {
      aniso = this.renderer.getMaxAnisotropy()
    } catch {
      // backend not ready: keep the default
    }
    this.glyphs = createGlyphAtlas(aniso)
    this.materials = createMaterials(this.u, this.glyphs)

    const room = buildRoom(geo, this.boxBase)
    const core = buildCore(geo, this.boxBase)
    this.edges = core.edges
    const add = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
      this.geometries.push(g)
      const mesh = new THREE.Mesh(g, m)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      this.scene.add(mesh)
    }
    add(room, this.materials.solid, 0)
    add(core.dark, this.materials.solid, 0)
    add(buildHaze(geo), this.materials.haze, 1)
    add(core.glow, this.materials.glow, 2)
    if (geo.lineCount > 0) add(buildLines(geo), this.materials.lines, 3)
    if (geo.particleCount > 0) add(buildParticles(geo), this.materials.points, 4)

    this.camera = new THREE.PerspectiveCamera(
      num(p.fov, 50),
      Math.max(1, ctx.width) / Math.max(1, ctx.height),
      0.05,
      80,
    )
    this.resize(ctx.width, ctx.height)

    this.post = new THREE.PostProcessing(this.renderer)
    this.post.outputColorTransform = false
    this.dofOn = p.depthOfField !== false
    this.chain = buildPostChain(this.scene, this.camera, this.u, this.pu, this.dofOn)
    this.post.outputNode = this.chain.output
  }

  private rebuildPost(dof: boolean) {
    for (const n of this.chain.nodes) n?.dispose?.()
    this.dofOn = dof
    this.chain = buildPostChain(this.scene, this.camera, this.u, this.pu, dof)
    this.post.outputNode = this.chain.output
    this.post.needsUpdate = true
  }

  resize(width: number, height: number) {
    const w = Math.max(1, width)
    const h = Math.max(1, height)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.u.viewport.value.set(w, h)
    this.pu.res.value.set(w, h)
  }

  private applyColors(p: Readonly<ParamValues>) {
    const shift = num(p.hueShift, 0)
    for (const [key, uniformKey, fallback] of COLOR_KEYS) {
      const c = this.color.set(str(p[key], fallback))
      if (shift !== 0) {
        c.getHSL(this.hsl)
        c.setHSL((((this.hsl.h + shift) % 1) + 1) % 1, this.hsl.s, this.hsl.l)
      }
      ;(this.u[uniformKey].value as THREE.Color).copy(c)
    }
  }

  private applyUniforms(p: Readonly<ParamValues>) {
    const u = this.u
    u.breath.value = num(p.blockBreath, 0.4)
    u.corePulse.value = num(p.corePulse, 0.55)
    u.flicker.value = num(p.flicker, 0.6)
    u.panelBright.value = num(p.panelBrightness, 1)
    u.glassIntensity.value = num(p.glassIntensity, 1)
    u.edgeGlow.value = num(p.edgeGlow, 1)
    u.coreGlow.value = num(p.coreGlow, 1)
    u.innerGlow.value = num(p.innerGlow, 1)
    u.flash.value = num(p.flash, 0)
    u.codeBright.value = num(p.codeBrightness, 1)
    u.codeColumns.value = Math.round(num(p.codeColumns, 8))
    u.lineIntensity.value = num(p.lineIntensity, 1)
    u.particleIntensity.value = num(p.particleIntensity, 1)
    u.dotSize.value = num(p.dotSize, 0.6)
    u.hazeAmount.value = num(p.haze, 1)
    u.fog.value = num(p.fog, 0.055)
    u.coreLight.value = num(p.coreLight, 1)
    u.reflect.value = num(p.reflections, 1)
    this.applyColors(p)

    const pu = this.pu
    pu.shafts.value = num(p.lightShafts, 0.8)
    pu.exposure.value = num(p.exposure, 1)
    pu.tealOrange.value = num(p.tealOrange, 1)
    pu.contrast.value = num(p.contrast, 0.3)
    pu.chroma.value = num(p.chromatic, 1)
    pu.vignette.value = num(p.vignette, 0.75)
    pu.grain.value = num(p.grain, 0.03)
    const bloom = this.chain.bloom
    bloom.strength.value = num(p.bloomStrength, 0.9)
    bloom.radius.value = num(p.bloomRadius, 0.5)
    bloom.threshold.value = num(p.bloomThreshold, 0.8)
  }

  private updateCamera(p: Readonly<ParamValues>, dolly: number) {
    const t = this.sceneTime
    const o = this.orbitTime
    const tumble = num(p.tumble, 0.9)
    const shake = num(p.shake, 0)
    const st = this.shakeTime
    const yaw = Math.PI * 0.25 + o * 0.3 + Math.sin(o * 0.11) * 0.6 * tumble
    const pitch =
      (-0.62 * Math.cos(o * 0.21) + 0.25 * Math.sin(o * 0.083 + 0.4)) * tumble +
      shake * 0.035 * Math.sin(st * 23.0)
    const roll =
      (0.55 * Math.sin(o * 0.13 + 1.3) + 0.2 * Math.sin(o * 0.29)) * num(p.roll, 0.6) +
      shake * 0.06 * Math.sin(st * 17.0 + 1.0)
    this.euler.set(pitch, yaw, roll, 'YXZ')
    this.quat.setFromEuler(this.euler)
    const drift = num(p.drift, 0.5)
    const dist = num(p.distance, 5.4) + Math.sin(o * 0.23) * 0.5 * drift - dolly
    this.target
      .set(Math.sin(t * 0.17) * 0.18, Math.cos(t * 0.13) * 0.14, Math.sin(t * 0.11 + 1.0) * 0.1)
      .multiplyScalar(drift)
    this.offset.set(0, 0, dist).applyQuaternion(this.quat)
    this.camera.position.copy(this.target).add(this.offset)
    this.camera.quaternion.copy(this.quat)
    const fov = num(p.fov, 50)
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.camera.updateMatrixWorld()
    ;(this.u.camRight.value as THREE.Vector3).set(1, 0, 0).applyQuaternion(this.quat)
    ;(this.u.camUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(this.quat)

    // Depth of field: the original's CoC knobs mapped onto the DOF node.
    const focus = dist + num(p.focusOffset, 0)
    this.pu.focus.value = focus
    this.pu.focalLength.value = Math.max(0.05, focus * num(p.focusRange, 0.22) * 1.6)
    this.pu.bokehScale.value =
      (num(p.aperture, 1) * (num(p.nearBlur, 24) * 0.6 + num(p.farBlur, 2.5) * 1.2)) / 17.4

    // Light shafts radiate from the core's screen position.
    this.ndc.set(0, 0, 0).project(this.camera)
    this.pu.shaftCenter.value.set(this.ndc.x * 0.5 + 0.5, this.ndc.y * 0.5 + 0.5)
  }

  /** Replicates the vertex-shader block motion so the 12 edge lights follow the blocks. */
  private updateEdgeLights(p: Readonly<ParamValues>) {
    const t = this.sceneTime
    const mt = this.u.moveTime.value as number
    const corePulse = num(p.corePulse, 0.55)
    const pulse = 1 + corePulse * (0.45 * Math.sin(t * 0.42) + 0.3 * Math.sin(t * 1.13 + 1.7))
    const flicker = 1 - 0.38 * num(p.flicker, 0.6) * 0.5
    const breathAmt = num(p.blockBreath, 0.4)
    const glow = num(p.coreGlow, 1) * (1 + num(p.flash, 0))
    const A = this.u.edgeA.array as THREE.Vector4[]
    const B = this.u.edgeB.array as THREE.Vector3[]
    for (let i = 0; i < 12; i++) {
      const a = A[i]!
      const b = B[i]!
      const E = this.edges[i]
      if (!E) {
        a.set(0, 0, 0, 0)
        b.set(0, 0, 0)
        continue
      }
      const T = mt * Math.abs(E.rate) + E.phase
      let e = Math.min(Math.max((T - Math.floor(T) - 0.55) / 0.45, 0), 1)
      e = e * e * e * (e * (e * 6 - 15) + 10)
      const hop = Math.floor(T) + e
      let sum = 0
      for (const blk of E.blocks) {
        let s = blk.slot + Math.sign(E.rate) * 0.5 * hop
        s = ((((s + 1) % 2) + 2) % 2) - 1
        sum += blk.bright * smoothstepJS(1, 0.78, Math.abs(s))
      }
      const breath = 1 + breathAmt * 0.07 * Math.sin(t * 0.8 + E.phase * 6.2831)
      a.set(E.a.x * breath, E.a.y * breath, E.a.z * breath, sum * pulse * flicker * glow * 0.5)
      b.copy(E.b).multiplyScalar(breath)
    }
  }

  update(frame: SceneFrame) {
    const { dt, params: p } = frame
    const u = this.u
    const sdt = dt * num(p.timeScale, 1)
    this.sceneTime += sdt
    this.shakeTime += dt
    u.time.value = this.sceneTime
    u.flowTime.value += sdt * num(p.lineFlow, 1)
    u.moveTime.value += sdt * num(p.blockSpeed, 1)
    u.codeTime.value += sdt * num(p.codeSpeed, 1)
    u.driftTime.value += sdt * num(p.particleDrift, 1)

    // Camera kick: a push along the orbit that coasts down, plus a short dolly-in.
    this.kickVel += num(p.cameraKick, 0) * dt * 2.5
    this.kickVel *= Math.exp(-dt / 0.6)
    this.orbitTime += sdt * num(p.orbitSpeed, 0.65) + this.kickVel * dt
    const dolly = Math.min(this.kickVel, 2) * 0.3

    const dof = p.depthOfField !== false
    if (dof !== this.dofOn) this.rebuildPost(dof)

    this.applyUniforms(p)
    this.updateCamera(p, dolly)
    this.updateEdgeLights(p)
    this.pu.damp.value = Math.pow(Math.min(Math.max(num(p.motionBlur, 0.45), 0), 0.95), dt * 60)
    this.pu.grainTime.value = performance.now() / 1000

    // Layers render with alpha = coverage over a transparent clear; the post
    // composite adds the background. Restore the host's clear afterwards.
    const r = this.renderer
    // Color4 is a Color with alpha; only the rgb part is read back here.
    r.getClearColor(this.savedClear as Parameters<typeof r.getClearColor>[0])
    const savedAlpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    try {
      this.post.render()
    } finally {
      r.setClearColor(this.savedClear, savedAlpha)
    }
  }

  dispose() {
    for (const n of this.chain.nodes) n?.dispose?.()
    this.post.dispose()
    for (const g of this.geometries) g.dispose()
    this.boxBase.dispose()
    for (const m of Object.values(this.materials)) m.dispose()
    this.glyphs.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new DigitalCore(ctx)
  // Render one frame now so every pipeline (scene + post) compiles inside
  // the host's shader-error scope instead of failing silently later.
  scene.update({ dt: 1 / 60, time: 0, params: ctx.params, audio: emptyFeatures() })
  await Promise.resolve()
  return scene
}
