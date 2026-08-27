/**
 * Engine-agnostic scene/slot navigation - a module-level singleton, not a
 * hook, since the MIDI dispatcher (see midi/dispatch.ts) listens to raw
 * `MIDIInput.onmidimessage` outside React and must call the exact same
 * logic the keyboard hook and SceneBar buttons use. React's only job is
 * registering the live `rig`/`context` when the engine powers on/off (see
 * hooks/useSceneEngine.ts); everything else calls the plain functions below.
 *
 * Behavioral contract (depended on by the MIDI dispatcher and useSceneHotkeys):
 * - Every entry point funnels through one private `applySlot` - no
 *   duplicated logic anywhere.
 * - The pointer (`sceneStore.activeScene`/`activeSlot`) moves as soon as a
 *   request wins the race below, even if there's no engine registered or
 *   the slot is empty - so the UI highlights instantly and a choice made
 *   while powered off is honored the moment the engine comes up.
 * - Serialized, latest-wins: every call is stamped with a monotonic
 *   sequence number at call time; by the time a queued call's turn to run
 *   arrives, it checks whether it's still the most recent request and
 *   no-ops (`reason: 'superseded'`) if not, before ever touching the
 *   pointer or the engine. This is what makes stomping a footswitch four
 *   times fast apply only the last preset instead of racing
 *   `applyPreset`'s rig-teardown-and-rebuild against itself.
 * - `goToScene` loads that scene's current `activeSlot` if it's non-empty,
 *   else the first non-empty slot, else nothing - matches hardware
 *   bank-switching (stay on the same footswitch position when it's usable).
 * - `nextScene`/`prevScene` wrap 63<->0; `nextSlot`/`prevSlot` wrap within
 *   the current scene.
 * - Never throws - `applyPreset` errors are caught, returned as
 *   `reason: 'error'`, and surfaced via toast.
 * - Also resolves and stores the "current preset" baseline in
 *   currentPresetStore (see state/currentPresetStore.ts) - what SceneBar's
 *   always-visible Save button diffs the live rig against. Resolved
 *   whenever a slot's preset id is known, independent of whether an engine
 *   is registered, so it's already correct the moment one comes up.
 * - Landing on an empty slot clears the grid (live rig, when one's
 *   registered, and the store either way) rather than leaving whatever the
 *   previous slot loaded still sitting there.
 */
import { applyPreset, type MissingAsset } from '../presets/apply'
import { getPreset } from '../presets/presetStore'
import type { PresetRig } from '../presets/types'
import { useCurrentPresetStore } from '../state/currentPresetStore'
import { useGraphStore } from '../state/graphStore'
import { toast } from '@openaxe/ui'
import { usePresetBankStore } from '../state/presetBankStore'
import { useSceneStore } from '../state/sceneStore'
import { useEngineVersion } from '../state/engineVersion'
import { SCENE_COUNT, SLOTS_PER_SCENE } from './types'

export type SceneNavSource = 'ui' | 'keyboard' | 'midi' | 'boot'

export type SceneNavFailure =
  | 'no-engine'
  | 'not-hydrated'
  | 'out-of-range'
  | 'empty-slot'
  | 'missing-preset'
  | 'superseded'
  | 'error'

export interface SceneNavResult {
  ok: boolean
  reason?: SceneNavFailure
  scene: number
  slot: number
  presetId: string | null
  missingAssets?: MissingAsset[]
}

export interface SceneNavOptions {
  source?: SceneNavSource
}

export interface SceneNavigatorTarget {
  rig: PresetRig
  context: AudioContext
}

let target: SceneNavigatorTarget | null = null
let seq = 0
/** Serializes every apply so two overlapping calls can never interleave `applyPreset` on the same rig. */
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn)
  chain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function wrap(n: number, count: number): number {
  return ((n % count) + count) % count
}

/**
 * Empties the grid - every live block on the rig (if one's registered) and
 * the store's block/edge list either way, keeping master level/mute as-is.
 * Mirrors applyPreset's own teardown loop, just with nothing to rebuild.
 */
async function clearGrid(): Promise<void> {
  if (target) {
    for (const id of [...target.rig.listBlockIds()]) {
      await target.rig.removeBlock(id)
    }
    useEngineVersion.getState().bump()
  }
  const { masterLevel, masterMuted } = useGraphStore.getState()
  useGraphStore.getState().loadGraph([], [], masterLevel, masterMuted)
}

async function applySlot(scene: number, slot: number, mySeq: number): Promise<SceneNavResult> {
  if (mySeq !== seq) return { ok: false, reason: 'superseded', scene, slot, presetId: null }

  const store = useSceneStore.getState()
  if (!store.hydrated) return { ok: false, reason: 'not-hydrated', scene, slot, presetId: null }
  if (scene < 0 || scene >= SCENE_COUNT || slot < 0 || slot >= SLOTS_PER_SCENE) {
    return { ok: false, reason: 'out-of-range', scene, slot, presetId: null }
  }

  useSceneStore.getState().setActive(scene, slot)
  const bankSlot = useSceneStore.getState().scenes[scene]?.slots[slot] ?? null
  // Resolve the scene slot's preset-bank reference to an actual preset id.
  const presetId = bankSlot != null ? (usePresetBankStore.getState().slots[bankSlot] ?? null) : null

  if (!presetId) {
    useCurrentPresetStore.getState().setSaved(null)
    await clearGrid()
    if (mySeq !== seq) return { ok: false, reason: 'superseded', scene, slot, presetId: null }
    return { ok: false, reason: 'empty-slot', scene, slot, presetId: null }
  }

  const preset = await getPreset(presetId)
  if (mySeq !== seq) return { ok: false, reason: 'superseded', scene, slot, presetId }
  if (!preset) {
    useCurrentPresetStore.getState().setSaved(null)
    return { ok: false, reason: 'missing-preset', scene, slot, presetId }
  }

  // The "current preset" baseline the Save button diffs against - resolved
  // regardless of engine power state, so it's already correct the moment
  // the engine comes up.
  useCurrentPresetStore.getState().setSaved(preset)

  if (!target) return { ok: false, reason: 'no-engine', scene, slot, presetId }

  useSceneStore.getState().setSwitching(true)
  try {
    const result = await applyPreset(target.context, preset, target.rig, useGraphStore)
    if (mySeq !== seq) return { ok: false, reason: 'superseded', scene, slot, presetId }
    useEngineVersion.getState().bump()
    if (result.missingAssets.length > 0) {
      toast.warning(
        `${result.missingAssets.length} model/IR reference(s) aren't cached on this device: ` +
          result.missingAssets.map((a) => a.name).join(', '),
        { description: 'The scene loaded, but those assets are missing locally.' },
      )
    }
    return { ok: true, scene, slot, presetId, missingAssets: result.missingAssets }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'error', scene, slot, presetId }
  } finally {
    useSceneStore.getState().setSwitching(false)
  }
}

function requestSlot(scene: number, slot: number): Promise<SceneNavResult> {
  const mySeq = ++seq
  return enqueue(() => applySlot(scene, slot, mySeq))
}

/** Resolves which slot `goToScene`/`nextScene`/`prevScene` should actually land on for a target scene. */
function resolveSceneEntrySlot(scene: number): number {
  const state = useSceneStore.getState()
  const sceneData = state.scenes[scene]
  if (!sceneData) return 0
  if (sceneData.slots[state.activeSlot] != null) return state.activeSlot
  const firstFilled = sceneData.slots.findIndex((s) => s != null)
  return firstFilled === -1 ? 0 : firstFilled
}

export const SceneNavigator = {
  setTarget(next: SceneNavigatorTarget | null): void {
    target = next
  },

  isReady(): boolean {
    return target !== null
  },

  getActive(): { scene: number; slot: number; presetId: string | null } {
    const state = useSceneStore.getState()
    const bankSlot = state.scenes[state.activeScene]?.slots[state.activeSlot] ?? null
    const presetId =
      bankSlot != null ? (usePresetBankStore.getState().slots[bankSlot] ?? null) : null
    return { scene: state.activeScene, slot: state.activeSlot, presetId }
  },

  goToSlot(slot: number, _opts?: SceneNavOptions): Promise<SceneNavResult> {
    const scene = useSceneStore.getState().activeScene
    return requestSlot(scene, slot)
  },

  goToScene(scene: number, _opts?: SceneNavOptions): Promise<SceneNavResult> {
    return requestSlot(scene, resolveSceneEntrySlot(scene))
  },

  nextScene(opts?: SceneNavOptions): Promise<SceneNavResult> {
    const scene = wrap(useSceneStore.getState().activeScene + 1, SCENE_COUNT)
    return SceneNavigator.goToScene(scene, opts)
  },

  prevScene(opts?: SceneNavOptions): Promise<SceneNavResult> {
    const scene = wrap(useSceneStore.getState().activeScene - 1, SCENE_COUNT)
    return SceneNavigator.goToScene(scene, opts)
  },

  nextSlot(_opts?: SceneNavOptions): Promise<SceneNavResult> {
    const state = useSceneStore.getState()
    return requestSlot(state.activeScene, wrap(state.activeSlot + 1, SLOTS_PER_SCENE))
  },

  prevSlot(_opts?: SceneNavOptions): Promise<SceneNavResult> {
    const state = useSceneStore.getState()
    return requestSlot(state.activeScene, wrap(state.activeSlot - 1, SLOTS_PER_SCENE))
  },

  reloadActive(_opts?: SceneNavOptions): Promise<SceneNavResult> {
    const state = useSceneStore.getState()
    return requestSlot(state.activeScene, state.activeSlot)
  },
}
