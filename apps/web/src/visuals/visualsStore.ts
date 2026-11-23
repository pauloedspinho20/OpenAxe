/**
 * VISUALS state: which scene is open, each scene's own param values and
 * audio routes, the shared audio-analysis settings, MIDI bindings and
 * recording preferences. Persisted through zustand's localStorage middleware
 * like the settings store (mirrored to disk in the native shells by
 * storage/prefsMirror.ts).
 *
 * Per-scene state only stores what differs from the scene's definition, so
 * a scene update that adds params or retunes defaults reaches users who
 * never touched them. Presets are named snapshots of that per-scene state
 * (params + audio routes), so they follow the same rule.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from './audio/FeatureEngine'
import type { MidiMatch } from '../midi/types'
import { findScene } from './registry'
import {
  defaultParams,
  type Modulation,
  type ParamValue,
  type ParamValues,
  type SceneDefinition,
} from './types'

export type AudioSourceMode = 'hybrid' | 'input' | 'output'

export interface SceneState {
  /** Overrides of the definition's defaults. */
  params: ParamValues
  /** null = use the definition's modulations unchanged. */
  modulations: Modulation[] | null
}

export interface VisualPreset {
  id: string
  name: string
  /** Snapshot of the scene's overrides and routes when saved. */
  params: ParamValues
  modulations: Modulation[] | null
  updatedAt: number
}

export interface MidiBinding {
  match: MidiMatch
  sceneId: string
  param: string
}

export interface RecordPrefs {
  sizeId: string
  fps: number
}

export interface PerformancePrefs {
  /** Multiplier on devicePixelRatio (capped at 2x the CSS size). */
  resolution: number
  /** 0 = uncapped (display rate). */
  fpsCap: number
}

export interface VisualsState {
  sceneId: string
  scenes: Record<string, SceneState>
  source: AudioSourceMode
  analysis: FeatureSettings
  performance: PerformancePrefs
  record: RecordPrefs
  midi: MidiBinding[]
  /** Saved presets, per scene. */
  presets: Record<string, VisualPreset[]>
  /** The preset each scene last loaded or saved, if any. */
  activePreset: Record<string, string | null>
  showMeters: boolean
  panelOpen: boolean
  /** Not persisted: param currently waiting for a CC. */
  learning: { sceneId: string; param: string } | null

  selectScene: (id: string) => void
  setParam: (sceneId: string, key: string, value: ParamValue) => void
  resetParams: (sceneId: string) => void
  setModulations: (sceneId: string, mods: Modulation[]) => void
  resetModulations: (sceneId: string) => void
  setSource: (source: AudioSourceMode) => void
  setAnalysis: (patch: Partial<FeatureSettings>) => void
  setPerformance: (patch: Partial<PerformancePrefs>) => void
  setRecord: (patch: Partial<RecordPrefs>) => void
  setShowMeters: (show: boolean) => void
  setPanelOpen: (open: boolean) => void
  startLearn: (sceneId: string, param: string) => void
  cancelLearn: () => void
  completeLearn: (match: MidiMatch) => void
  removeBinding: (sceneId: string, param: string) => void
  /** Saves the scene's current state as a new preset; returns its id. */
  savePreset: (sceneId: string, name: string) => string
  /** Overwrites a preset with the scene's current state. */
  updatePreset: (sceneId: string, presetId: string) => void
  loadPreset: (sceneId: string, presetId: string) => void
  renamePreset: (sceneId: string, presetId: string, name: string) => void
  deletePreset: (sceneId: string, presetId: string) => void
}

const EMPTY_SCENE: SceneState = { params: {}, modulations: null }

const snapshot = (state: SceneState | undefined) => ({
  params: { ...(state?.params ?? {}) },
  modulations: state?.modulations ? state.modulations.map((m) => ({ ...m })) : null,
})

let presetSeq = 0
const presetId = () => `p-${Date.now().toString(36)}-${(presetSeq++).toString(36)}`

/** Whether the scene's current state differs from a preset's snapshot. */
export function presetIsDirty(preset: VisualPreset, state: SceneState | undefined): boolean {
  const cur = snapshot(state)
  return (
    JSON.stringify(cur.params) !== JSON.stringify(preset.params) ||
    JSON.stringify(cur.modulations) !== JSON.stringify(preset.modulations)
  )
}

export const useVisualsStore = create<VisualsState>()(
  persist(
    (set) => ({
      sceneId: findScene(null).id,
      scenes: {},
      source: 'hybrid',
      analysis: { ...DEFAULT_FEATURE_SETTINGS },
      performance: { resolution: 0.75, fpsCap: 60 },
      record: { sizeId: '1080p', fps: 60 },
      midi: [],
      presets: {},
      activePreset: {},
      showMeters: true,
      panelOpen: true,
      learning: null,

      selectScene: (id) => set({ sceneId: findScene(id).id }),
      setParam: (sceneId, key, value) =>
        set((s) => {
          const cur = s.scenes[sceneId] ?? EMPTY_SCENE
          return {
            scenes: { ...s.scenes, [sceneId]: { ...cur, params: { ...cur.params, [key]: value } } },
          }
        }),
      resetParams: (sceneId) =>
        set((s) => ({
          scenes: { ...s.scenes, [sceneId]: { ...(s.scenes[sceneId] ?? EMPTY_SCENE), params: {} } },
        })),
      setModulations: (sceneId, mods) =>
        set((s) => ({
          scenes: {
            ...s.scenes,
            [sceneId]: { ...(s.scenes[sceneId] ?? EMPTY_SCENE), modulations: mods },
          },
        })),
      resetModulations: (sceneId) =>
        set((s) => ({
          scenes: {
            ...s.scenes,
            [sceneId]: { ...(s.scenes[sceneId] ?? EMPTY_SCENE), modulations: null },
          },
        })),
      setSource: (source) => set({ source }),
      setAnalysis: (patch) => set((s) => ({ analysis: { ...s.analysis, ...patch } })),
      setPerformance: (patch) => set((s) => ({ performance: { ...s.performance, ...patch } })),
      setRecord: (patch) => set((s) => ({ record: { ...s.record, ...patch } })),
      setShowMeters: (showMeters) => set({ showMeters }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      startLearn: (sceneId, param) => set({ learning: { sceneId, param } }),
      cancelLearn: () => set({ learning: null }),
      completeLearn: (match) =>
        set((s) => {
          if (!s.learning) return s
          const { sceneId, param } = s.learning
          const same = (b: MidiBinding) =>
            (b.sceneId === sceneId && b.param === param) ||
            (b.sceneId === sceneId &&
              b.match.type === match.type &&
              b.match.channel === match.channel &&
              b.match.number === match.number)
          return {
            learning: null,
            midi: [...s.midi.filter((b) => !same(b)), { match, sceneId, param }],
          }
        }),
      removeBinding: (sceneId, param) =>
        set((s) => ({ midi: s.midi.filter((b) => !(b.sceneId === sceneId && b.param === param)) })),

      savePreset: (sceneId, name) => {
        const id = presetId()
        set((s) => {
          const preset: VisualPreset = {
            id,
            name: name.trim() || 'Untitled',
            ...snapshot(s.scenes[sceneId]),
            updatedAt: Date.now(),
          }
          return {
            presets: { ...s.presets, [sceneId]: [...(s.presets[sceneId] ?? []), preset] },
            activePreset: { ...s.activePreset, [sceneId]: id },
          }
        })
        return id
      },
      updatePreset: (sceneId, id) =>
        set((s) => ({
          presets: {
            ...s.presets,
            [sceneId]: (s.presets[sceneId] ?? []).map((p) =>
              p.id === id ? { ...p, ...snapshot(s.scenes[sceneId]), updatedAt: Date.now() } : p,
            ),
          },
          activePreset: { ...s.activePreset, [sceneId]: id },
        })),
      loadPreset: (sceneId, id) =>
        set((s) => {
          const preset = (s.presets[sceneId] ?? []).find((p) => p.id === id)
          if (!preset) return s
          return {
            scenes: { ...s.scenes, [sceneId]: snapshot(preset) },
            activePreset: { ...s.activePreset, [sceneId]: id },
          }
        }),
      renamePreset: (sceneId, id, name) =>
        set((s) => ({
          presets: {
            ...s.presets,
            [sceneId]: (s.presets[sceneId] ?? []).map((p) =>
              p.id === id ? { ...p, name: name.trim() || p.name } : p,
            ),
          },
        })),
      deletePreset: (sceneId, id) =>
        set((s) => ({
          presets: {
            ...s.presets,
            [sceneId]: (s.presets[sceneId] ?? []).filter((p) => p.id !== id),
          },
          activePreset: {
            ...s.activePreset,
            [sceneId]: s.activePreset[sceneId] === id ? null : (s.activePreset[sceneId] ?? null),
          },
        })),
    }),
    {
      name: 'openaxe-visuals',
      version: 1,
      partialize: ({ learning: _learning, ...rest }) =>
        Object.fromEntries(
          Object.entries(rest).filter(([, v]) => typeof v !== 'function'),
        ) as Partial<VisualsState>,
    },
  ),
)

/** Definition defaults merged with the user's overrides (unknown keys dropped). */
export function resolveParams(def: SceneDefinition, state: SceneState | undefined): ParamValues {
  const values = defaultParams(def)
  const overrides = state?.params ?? {}
  for (const p of def.params) {
    if (p.type === 'action') continue
    const v = overrides[p.key]
    if (v === undefined || typeof v !== typeof p.default) continue
    if (p.type === 'number') {
      values[p.key] = Math.min(p.max, Math.max(p.min, v as number))
    } else if (p.type === 'select') {
      if (p.options.some((o) => o.value === v)) values[p.key] = v
    } else values[p.key] = v
  }
  return values
}

export function resolveModulations(
  def: SceneDefinition,
  state: SceneState | undefined,
): Modulation[] {
  const mods = state?.modulations ?? def.modulations
  const valid = new Set(
    def.params.filter((p) => p.type === 'number' && !p.rebuild).map((p) => p.key),
  )
  return mods.filter((m) => valid.has(m.param))
}
