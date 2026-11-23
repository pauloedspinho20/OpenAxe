/**
 * The contract between the VISUALS host and a scene.
 *
 * Scenes are deliberately opaque to the host: each one owns its own
 * three.js scene graph, cameras, materials, post-processing and logic, and
 * may look nothing like the others (a fullscreen ray-marcher, a particle
 * compute sim, a mesh scene...). The host only provides:
 *
 * - a shared `WebGPURenderer` (WebGPU, or its WebGL2 fallback) and its canvas,
 * - per-frame time, the audio features and the *modulated* param values,
 * - size changes and pointer input.
 *
 * Everything a scene exposes to the user is declared up front as data
 * (`params`, default `modulations`, `credit`) so the global control panel,
 * persistence and MIDI learn work for every scene with no per-scene UI code.
 * Scene code is lazy-loaded through `load()` so the VISUALS bundle only
 * pulls in three.js and the scenes actually opened.
 */
import type { WebGPURenderer } from 'three/webgpu'

import type { AudioFeatures, FeatureId } from './audio/features'

interface ParamBase {
  /** Stable id, used in persistence and MIDI bindings. Never rename a shipped key. */
  readonly key: string
  readonly label: string
  /** Panel section, e.g. 'Animation', 'Material'. */
  readonly group: string
  readonly description?: string
  /**
   * Changing it needs the scene rebuilt (shader recompile, new geometry...).
   * The host applies it on release, never per frame, and it cannot be modulated.
   */
  readonly rebuild?: boolean
}

export interface NumberParam extends ParamBase {
  readonly type: 'number'
  readonly min: number
  readonly max: number
  readonly step: number
  readonly default: number
  readonly unit?: string
  /** Wraps instead of clamping when modulated (angles, hue). */
  readonly wrap?: boolean
}

export interface ColorParam extends ParamBase {
  readonly type: 'color'
  /** '#rrggbb' */
  readonly default: string
}

export interface BooleanParam extends ParamBase {
  readonly type: 'boolean'
  readonly default: boolean
}

export interface SelectParam extends ParamBase {
  readonly type: 'select'
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly default: string
}

/** A button: no value, calls `SceneInstance.action(key)`. */
export interface ActionParam extends ParamBase {
  readonly type: 'action'
}

export type SceneParam = NumberParam | ColorParam | BooleanParam | SelectParam | ActionParam
export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

export type ModCurve = 'linear' | 'ease' | 'expo' | 'gate'

/** One audio -> param route. */
export interface Modulation {
  readonly id: string
  /** Key of a `NumberParam` that is not `rebuild`. */
  readonly param: string
  readonly source: FeatureId
  /** Fraction of the param's range added at full feature, -1..1. */
  readonly amount: number
  readonly curve: ModCurve
  /** Extra smoothing on top of the feature's own, seconds. 0 = none. */
  readonly attack: number
  readonly release: number
  readonly enabled: boolean
}

export interface SceneCredit {
  readonly author: string
  readonly url?: string
  readonly license?: string
  /** E.g. "Adapted from the original GLSL; ported to TSL and made audio reactive." */
  readonly note?: string
}

export interface SceneFrame {
  /** Seconds since the previous frame (clamped). */
  readonly dt: number
  /** Seconds since the scene was created. */
  readonly time: number
  /** Base values with modulation applied - what the scene should render with. */
  readonly params: Readonly<ParamValues>
  readonly audio: Readonly<AudioFeatures>
}

export interface SceneContext {
  readonly renderer: WebGPURenderer
  readonly canvas: HTMLCanvasElement
  /** Drawing-buffer size in physical pixels. */
  readonly width: number
  readonly height: number
  readonly params: Readonly<ParamValues>
}

export interface ScenePointerEvent {
  readonly type: 'down' | 'move' | 'up'
  readonly id: number
  /** CSS pixels relative to the canvas. */
  readonly x: number
  readonly y: number
}

export interface SceneInstance {
  /** Advance and render one frame (the scene calls the renderer itself). */
  update(frame: SceneFrame): void
  /** Drawing-buffer size changed. */
  resize(width: number, height: number): void
  /** Optional hook for discrete changes (e.g. a colour pick) outside the frame loop. */
  setParam?(key: string, value: ParamValue): void
  action?(key: string): void
  pointer?(event: ScenePointerEvent): void
  dispose(): void
}

export interface SceneModule {
  createScene(ctx: SceneContext): SceneInstance | Promise<SceneInstance>
}

export interface SceneDefinition {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly credit?: SceneCredit
  readonly params: readonly SceneParam[]
  /** The tuned starting routes; users can edit, disable or reset them. */
  readonly modulations: readonly Modulation[]
  readonly load: () => Promise<SceneModule>
}

export function defaultParams(def: SceneDefinition): ParamValues {
  const values: ParamValues = {}
  for (const p of def.params) if (p.type !== 'action') values[p.key] = p.default
  return values
}

export function isModulatable(p: SceneParam): p is NumberParam {
  return p.type === 'number' && !p.rebuild
}
