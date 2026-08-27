/**
 * A "scene bank" is a fixed set of 64 scenes, each holding 8 preset slots -
 * the hardware-pedalboard-bank-and-patch idiom. Fixed counts (not
 * user-creatable/deletable) so the whole thing is one small, always-valid
 * blob rather than a growable collection needing its own CRUD.
 *
 * A scene slot does NOT hold a preset directly - it references a slot number
 * in the 512-slot preset bank (see presets/presetBank.ts). Presets live in
 * the bank; scenes point at bank slots. Empty scene slot = null.
 */
export const SCENE_COUNT = 64
export const SLOTS_PER_SCENE = 8

export interface Scene {
  /** 0-63, redundant with array position but keeps a Scene self-describing when passed around. */
  index: number
  name: string
  /** Exactly SLOTS_PER_SCENE entries. A value is a preset-bank slot index (0-511); null is an empty slot. */
  slots: (number | null)[]
}

export interface SceneBank {
  /** Singleton row key - there is exactly one bank per browser. */
  id: 'default'
  /** Blob schema version, independent of storage/db.ts's DB_VERSION - lets normalizeBank migrate in place. */
  version: 1
  scenes: Scene[]
  activeScene: number
  activeSlot: number
  updatedAt: number
}
