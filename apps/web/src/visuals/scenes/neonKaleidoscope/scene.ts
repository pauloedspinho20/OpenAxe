/**
 * Neon Kaleidoscope - a fullscreen TSL fragment shader (see ./definition.ts
 * for credit). Each layer folds the domain into a repeating cell, measures a
 * rounded/faceted shape field, and adds a glowing band tinted by a cosine
 * palette. The layer loop is unrolled in JS (`iterations` is a rebuild param);
 * everything else is a uniform. Colour and band phases are integrated on the
 * CPU so a modulated rate never makes the motion jump backwards.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  abs,
  clamp,
  cos,
  exp,
  float,
  fract,
  length,
  max,
  mix,
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

/* eslint-disable @typescript-eslint/no-explicit-any */
// TSL node types are too dynamic for useful static typing here.
type N = any

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function buildMaterial(layers: number) {
  const u = {
    cellScale: uniform(1.16),
    formRadius: uniform(0.69),
    formAngularity: uniform(1),
    cornerWeight: uniform(0.45),
    bandFrequency: uniform(36.1),
    bandDivisor: uniform(3.41),
    layerShift: uniform(0.5),
    lightWidth: uniform(0.02),
    lightPower: uniform(1.5),
    brightness: uniform(1),
    colorT: uniform(0),
    phaseT: uniform(0),
  }

  const colorField = (phase: N) =>
    vec3(0.02, 0.02, 0.761).add(
      vec3(0.09, 0.129, 0.91).mul(
        cos(
          vec3(0.259, 0.58, 1.0)
            .mul(phase)
            .add(vec3(0.957, 0.341, 1.0))
            .mul(5.24),
        ),
      ),
    )

  const shapeField = (p: N) => {
    const a = abs(p)
    const rounded = length(a)
    const faceted = a.x.add(a.y).mul(u.cornerWeight)
    return mix(rounded, faceted, u.formAngularity).sub(u.formRadius)
  }

  const fragment = Fn(() => {
    // TSL's screenCoordinate is top-left on both backends; flip to bottom-left.
    const fc = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))
    const screen = fc.mul(2).sub(screenSize).div(screenSize.y)
    const radial = length(screen)
    const falloff = exp(radial.negate())

    let domain: N = screen
    let radiance: N = vec3(0)
    for (let i = 0; i < layers; i++) {
      domain = fract(domain.mul(u.cellScale)).sub(0.5)
      const field = shapeField(domain).mul(falloff)
      const phase = radial.add(u.colorT).add(u.layerShift.mul(i))
      const wave = sin(field.mul(u.bandFrequency).sub(u.phaseT)).div(u.bandDivisor)
      const dist = max(abs(wave), 0.0001)
      const intensity = pow(u.lightWidth.div(dist), u.lightPower)
      radiance = radiance.add(colorField(phase).mul(intensity))
    }

    const col = clamp(radiance.mul(u.brightness), 0, 1)
    // Display-space result -> linear, so the renderer's sRGB encode restores it.
    return vec4(pow(col, vec3(2.2)), float(1))
  })

  const material = new THREE.MeshBasicNodeMaterial()
  material.vertexNode = vec4(positionGeometry.xy, 0, 1)
  material.fragmentNode = fragment()
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return { material, u }
}

class NeonKaleidoscope implements SceneInstance {
  private readonly renderer: THREE.WebGPURenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicNodeMaterial
  private readonly u: ReturnType<typeof buildMaterial>['u']
  private colorT = 0
  private phaseT = 0

  constructor(ctx: SceneContext) {
    this.renderer = ctx.renderer
    const layers = Math.min(12, Math.max(1, Math.round(num(ctx.params.iterations, 10))))
    const built = buildMaterial(layers)
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
    u.cellScale.value = num(p.cellScale, 1.16)
    u.formRadius.value = num(p.formRadius, 0.69)
    u.formAngularity.value = num(p.formAngularity, 1)
    u.cornerWeight.value = num(p.cornerWeight, 0.45)
    u.bandFrequency.value = num(p.bandFrequency, 36.1)
    u.bandDivisor.value = num(p.bandDivisor, 3.41)
    u.layerShift.value = num(p.layerShift, 0.5)
    u.lightWidth.value = num(p.lightWidth, 0.02)
    u.lightPower.value = num(p.lightPower, 1.5)
    u.brightness.value = num(p.brightness, 1)
    // One palette period is 2*pi/5.24 of phase, so the hue shift spans it.
    u.colorT.value = this.colorT + num(p.hueShift, 0) * 1.2
    u.phaseT.value = this.phaseT
  }

  update(frame: SceneFrame) {
    const p = frame.params
    const t = p.paused === true ? 0 : frame.dt * num(p.timeScale, 1)
    this.colorT += t * num(p.colorRate, 0.5)
    this.phaseT += t * num(p.phaseRate, 1)
    this.sync(p)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export async function createScene(ctx: SceneContext): Promise<SceneInstance> {
  const scene = new NeonKaleidoscope(ctx)
  await scene.compile()
  return scene
}
