/**
 * Inside Quantum Core - a fullscreen TSL ray-marcher (see ./definition.ts for
 * credit). Each ray is stepped through a space that is shifted, mirrored,
 * perturbed and angularly folded; the distance to a pair of crossing cylinders
 * (plus a few extra folds) sets the step length, and light is accumulated as
 * 1/distance with a spectral tint. `traceSteps` is the Loop bound and
 * `foldSteps` is unrolled in JS (both rebuild params). Travel and mirror
 * phases are integrated on the CPU so modulated speeds never jump backwards.
 *
 * Intermediate positions are `.toVar()`d: otherwise TSL would inline each
 * transform at every use, multiplying the shader size per fold.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  Loop,
  atan,
  clamp,
  exp,
  float,
  length,
  max,
  min,
  mod,
  normalize,
  positionGeometry,
  pow,
  reflect,
  screenCoordinate,
  screenSize,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'

import type { ParamValues, SceneContext, SceneFrame, SceneInstance } from '../../types'

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

function buildMaterial(traceSteps: number, foldSteps: number) {
  const u = {
    travelT: uniform(0),
    mirrorT: uniform(0),
    fadeNear: uniform(0.4),
    fadeFar: uniform(2),
    startDepth: uniform(2.1),
    traceFactor: uniform(0.2),
    primaryPeriod: uniform(15.2),
    primaryOffset: uniform(9.9),
    secondaryPeriod: uniform(6.7),
    secondaryOffset: uniform(5.1),
    detailScale: uniform(22),
    detailAmount: uniform(1.5),
    verticalOffset: uniform(12.9),
    angularPeriod: uniform(0.628),
    spectralPhase: uniform(new THREE.Vector3(0.9, 2.8, 5.2)),
    lightColor: uniform(new THREE.Vector3(0.567, 0.533, 1)),
    lightIntensity: uniform(3),
    outputScale: uniform(1000),
  }
  const mirrorPhase = vec3(0.063, 0.212, 1.046)

  /** Fold the xz plane into one angular wedge; y is untouched. */
  const angularFold = (p: N) => {
    const radius = length(p.xz).toVar()
    const angle = atan(p.z, p.x)
    const sector = mod(angle, u.angularPeriod).sub(u.angularPeriod.mul(0.5))
    return vec3(radius, p.y, radius.mul(sector)).toVar()
  }

  const crossSection = (p: N) => length(p.yz)

  const transformSample = (pos: N) => {
    let p: N = vec3(pos.x, pos.y.add(u.verticalOffset), pos.z).toVar()
    const axis = normalize(sin(u.mirrorT.add(mirrorPhase)))
    p = reflect(p, axis).toVar()
    p = p.add(sin(p.mul(u.detailScale)).div(max(u.detailAmount, 0.0001))).toVar()
    p = angularFold(p)
    return vec3(p.x, mod(p.y, max(u.primaryPeriod, 0.0001)).sub(u.primaryOffset), p.z).toVar()
  }

  const evaluateField = (pos: N) => {
    let p: N = pos
    let d: N = crossSection(p).toVar()
    for (let i = 0; i < foldSteps; i++) {
      p = angularFold(p.zxy)
      p = vec3(
        p.x,
        mod(p.y.add(u.travelT), max(u.secondaryPeriod, 0.0001)).sub(u.secondaryOffset),
        p.z,
      ).toVar()
      d = min(d, crossSection(p)).toVar()
    }
    return d
  }

  const fragment = Fn(() => {
    // TSL's screenCoordinate is top-left on both backends; flip to bottom-left.
    const px = screenCoordinate.x
    const py = screenSize.y.sub(screenCoordinate.y)
    const ray = normalize(
      vec3(1, px.mul(2), py.mul(2)).sub(vec3(screenSize.y, screenSize.x, screenSize.y)),
    )

    const light = vec3(0).toVar()
    const depth = float(u.startDepth).toVar()
    Loop(traceSteps, () => {
      const sample = transformSample(ray.mul(depth))
      const dist = evaluateField(sample).toVar()
      depth.addAssign(dist.mul(u.traceFactor))
      const fade = smoothstep(u.fadeNear, u.fadeFar, depth)
      const spectral = exp(sin(depth.add(u.spectralPhase)))
      light.addAssign(
        u.lightColor.mul(u.lightIntensity).mul(spectral).mul(fade).div(max(dist, 0.0001)),
      )
    })

    // tanh is not in TSL: (e^2x - 1) / (e^2x + 1), with x capped so e^2x can't overflow.
    const x = min(light.div(max(u.outputScale, 0.0001)), 20)
    const e2x = exp(x.mul(2))
    const col = clamp(e2x.sub(1).div(e2x.add(1)), 0, 1)
    // Display-space result -> linear, so the renderer's sRGB encode restores it.
    return vec4(pow(col, vec3(2.2)), 1)
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.fragmentNode = fragment()
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return { material, u }
}

class QuantumCore implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicNodeMaterial
  private readonly u: ReturnType<typeof buildMaterial>['u']
  private travelT = 0
  private mirrorT = 0

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    const trace = Math.min(128, Math.max(1, Math.round(num(ctx.params.traceSteps, 54))))
    const fold = Math.min(8, Math.max(0, Math.round(num(ctx.params.foldSteps, 3))))
    const built = buildMaterial(trace, fold)
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

  private sync(p: Readonly<ParamValues>) {
    const u = this.u
    u.travelT.value = this.travelT
    u.mirrorT.value = this.mirrorT
    u.fadeNear.value = num(p.cameraFadeNear, 0.4)
    u.fadeFar.value = num(p.cameraFadeFar, 2)
    u.startDepth.value = num(p.startDepth, 2.1)
    u.traceFactor.value = num(p.traceFactor, 0.2)
    u.primaryPeriod.value = num(p.primaryPeriod, 15.2)
    u.primaryOffset.value = num(p.primaryOffset, 9.9)
    u.secondaryPeriod.value = num(p.secondaryPeriod, 6.7)
    u.secondaryOffset.value = num(p.secondaryOffset, 5.1)
    u.detailScale.value = num(p.detailScale, 22)
    u.detailAmount.value = num(p.detailAmount, 1.5)
    u.verticalOffset.value = num(p.verticalOffset, 12.9)
    u.angularPeriod.value = num(p.angularPeriod, 0.628)
    u.lightIntensity.value = num(p.lightIntensity, 3)
    u.outputScale.value = num(p.outputScale, 1000)

    const h = num(p.hueShift, 0) * TAU
    ;(u.spectralPhase.value as THREE.Vector3).set(0.9 + h, 2.8 + h, 5.2 + h)
    const [r, g, b] = hexToRgb(String(p.lightColor ?? '#8188ff'))
    ;(u.lightColor.value as THREE.Vector3).set(r, g, b)
  }

  update(frame: SceneFrame) {
    const p = frame.params
    const t = p.paused === true ? 0 : frame.dt * num(p.timeScale, 1)
    this.travelT += t * num(p.travelRate, 0.26)
    this.mirrorT += t * num(p.mirrorSpeed, 0.07)
    this.sync(p)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new QuantumCore(ctx)
  await scene.compile()
  return scene
}
