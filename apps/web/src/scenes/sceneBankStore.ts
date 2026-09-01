/**
 * Persistence for the scene bank - a single row (see types.ts for
 * why one blob rather than 64 rows), mirroring presetStore.ts's thin-CRUD
 * style. Shares the app's one database via storage/db.ts.
 */
import { STORE_SCENES } from '../storage/db'
import { kvDelete, kvGet, kvPut } from '../storage/kv'
import { PRESET_SLOT_COUNT } from '../presets/presetBank'
import { SCENE_COUNT, SLOTS_PER_SCENE, type Scene, type SceneBank } from './types'

const SCENE_BANK_ID = 'default'

export async function saveSceneBank(bank: SceneBank): Promise<void> {
  await kvPut(STORE_SCENES, bank)
}

/** Read the scene bank, normalizing whatever's stored - null if nothing's been saved yet. */
export async function loadSceneBank(): Promise<SceneBank | null> {
  const result = await kvGet<SceneBank>(STORE_SCENES, SCENE_BANK_ID)
  return result ? normalizeBank(result) : null
}

export async function clearSceneBank(): Promise<void> {
  await kvDelete(STORE_SCENES, SCENE_BANK_ID)
}

/** A fresh bank: 64 unnamed scenes, every slot empty. */
export function createEmptyBank(): SceneBank {
  return {
    id: SCENE_BANK_ID,
    version: 1,
    scenes: Array.from({ length: SCENE_COUNT }, (_, index) => ({
      index,
      name: '',
      slots: Array.from({ length: SLOTS_PER_SCENE }, () => null),
    })),
    activeScene: 0,
    activeSlot: 0,
    updatedAt: 0,
  }
}

function normalizeScene(raw: unknown, index: number): Scene {
  const r = (raw ?? {}) as Partial<Scene>
  const slots = Array.isArray(r.slots) ? r.slots : []
  return {
    index,
    name: typeof r.name === 'string' ? r.name : '',
    slots: Array.from({ length: SLOTS_PER_SCENE }, (_, i) => {
      const v = slots[i]
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PRESET_SLOT_COUNT
        ? v
        : null
    }),
  }
}

/**
 * Defensively pads/truncates array lengths and clamps indices - this is the
 * one persisted structure the whole UI indexes into blindly (scene[i],
 * slots[j]), so a corrupt or older-shape record must not crash the app on
 * boot. Returns null only if `raw` isn't even object-shaped.
 */
export function normalizeBank(raw: unknown): SceneBank | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<SceneBank>
  const rawScenes = Array.isArray(r.scenes) ? r.scenes : []
  const scenes = Array.from({ length: SCENE_COUNT }, (_, i) => normalizeScene(rawScenes[i], i))
  const clamp = (n: unknown, max: number) => (typeof n === 'number' && n >= 0 && n < max ? n : 0)
  return {
    id: 'default',
    version: 1,
    scenes,
    activeScene: clamp(r.activeScene, SCENE_COUNT),
    activeSlot: clamp(r.activeSlot, SLOTS_PER_SCENE),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}
