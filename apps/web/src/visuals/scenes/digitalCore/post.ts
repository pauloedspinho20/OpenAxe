/**
 * Digital Core post chain, rebuilt on three's node PostProcessing:
 *
 *   scene pass -> background composite -> [DOF] -> afterImage (motion smear)
 *   -> light shafts -> + bloom -> ACES (exposure) + sRGB encode
 *   -> grade (chromatic aberration, teal/orange, contrast, vignette, grain)
 *
 * Differences from the original (EffectComposer, WebGL only):
 * - The 5-layer depth-of-field (scene rendered once per CoC layer) became
 *   the stock DepthOfFieldNode on the scene depth; the original knobs map
 *   onto its focus distance / focal length / bokeh scale.
 * - The temporal blend pass became `afterImage`.
 * - Light shafts sample the HDR frame at full resolution in one pass
 *   instead of extract + half-res radial blur.
 * The chain does its own tone mapping and sRGB encode
 * (`outputColorTransform = false`), so the shared renderer's settings are
 * never touched.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  Loop,
  acesFilmicToneMapping,
  clamp,
  convertToTexture,
  dot,
  float,
  fract,
  length,
  max,
  min,
  mix,
  pass,
  smoothstep,
  sRGBTransferOETF,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'

import type { Uniforms } from './materials'

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any

export function createPostUniforms() {
  return {
    focus: uniform(5.4),
    focalLength: uniform(2.2),
    bokehScale: uniform(1),
    damp: uniform(0),
    shaftCenter: uniform(new THREE.Vector2(0.5, 0.5)),
    shafts: uniform(0.8),
    exposure: uniform(1),
    tealOrange: uniform(1),
    contrast: uniform(0.3),
    chroma: uniform(1),
    vignette: uniform(0.75),
    grain: uniform(0.03),
    grainTime: uniform(0),
    res: uniform(new THREE.Vector2(1, 1)),
  }
}

export type PostUniforms = ReturnType<typeof createPostUniforms>

const SHAFT_SAMPLES = 40

export function buildPostChain(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  u: Uniforms,
  p: PostUniforms,
  depthOfField: boolean,
): { output: N; bloom: N; nodes: N[] } {
  const scenePass = pass(scene, camera)
  const color = scenePass.getTextureNode('output')

  // Layers are rendered with alpha = coverage; the background fills the rest.
  const composite = Fn(() => {
    const c = color.sample(uv())
    const rgb = c.rgb.add(u.base.mul(float(1).sub(clamp(c.a, 0.0, 1.0))))
    return vec4(min(max(rgb, vec3(0)), vec3(64.0)), 1.0)
  })()

  let focused: N = composite
  if (depthOfField) {
    focused = dof(composite, scenePass.getViewZNode(), p.focus, p.focalLength, p.bokehScale)
  }

  const smeared = afterImage(focused, p.damp)
  const hdrTex: N = convertToTexture(smeared)

  const shafts = Fn(() => {
    const base = uv().toVar()
    const step = base
      .sub(p.shaftCenter)
      .mul(0.55 / SHAFT_SAMPLES)
      .toVar()
    const pos = vec2(base).toVar()
    const acc = vec3(0).toVar()
    const w = float(1).toVar()
    const ws = float(0).toVar()
    Loop(SHAFT_SAMPLES, () => {
      const s = hdrTex.sample(pos).rgb.toVar()
      const l = dot(s, vec3(0.2126, 0.7152, 0.0722))
      acc.addAssign(s.mul(smoothstep(0.9, 2.25, l)).mul(w))
      ws.addAssign(w)
      pos.subAssign(step)
      w.mulAssign(0.955)
    })
    return acc.div(ws)
  })()

  const hdr = hdrTex.sample(uv()).rgb.add(shafts.mul(p.shafts))
  const bloomNode: N = bloom(vec4(hdr, 1.0), 0.9, 0.5, 0.8)
  const lit = hdr.add(bloomNode.rgb)

  const display = sRGBTransferOETF(acesFilmicToneMapping(lit, p.exposure))
  const dispTex: N = convertToTexture(vec4(display, 1.0))

  const hash = Fn(([q]: N[]) => {
    const p3 = fract(vec3(q.x, q.y, q.x).mul(0.1031)).toVar()
    p3.addAssign(dot(p3, p3.yzx.add(33.33)))
    return fract(p3.x.add(p3.y).mul(p3.z))
  }).setLayout({ name: 'dcGrainHash', type: 'float', inputs: [{ name: 'q', type: 'vec2' }] })

  const output = Fn(() => {
    const t = uv().toVar()
    const dir = t.sub(0.5)
    const off = dir.mul(length(dir)).mul(0.012).mul(p.chroma).toVar()
    const c = vec3(
      dispTex.sample(t.sub(off)).r,
      dispTex.sample(t).g,
      dispTex.sample(t.add(off)).b,
    ).toVar()
    // teal & orange: pull magenta mixes (orange + blue) back to warm orange
    const mg = max(min(c.x, c.z).sub(c.y), 0.0)
    c.assign(
      vec3(c.x, c.y.add(mg.mul(0.3).mul(p.tealOrange)), c.z.sub(mg.mul(0.85).mul(p.tealOrange))),
    )
    c.assign(clamp(c, 0.0, 1.0))
    c.assign(mix(c, c.mul(c).mul(vec3(3.0).sub(c.mul(2.0))), p.contrast))
    const q = t.sub(0.5).mul(vec2(p.res.x.div(p.res.y), 1.0))
    const v = float(1).sub(smoothstep(0.3, 1.0, length(q).mul(1.05)))
    c.mulAssign(mix(float(1), v, p.vignette))
    c.addAssign(
      hash(t.mul(p.res).add(fract(p.grainTime.mul(7.31)).mul(911.0)))
        .sub(0.5)
        .mul(p.grain),
    )
    return vec4(max(c, vec3(0)), 1.0)
  })()
  return {
    output,
    bloom: bloomNode,
    nodes: [scenePass, focused, smeared, hdrTex, bloomNode, dispTex],
  }
}
