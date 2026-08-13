/**
 * A "scene bank" is a fixed set of 64 scenes, each holding 8 preset slots -
 * the hardware-pedalboard-bank-and-patch idiom. Fixed counts (not
 * user-creatable/deletable) so the whole thing is one small, always-valid
 * blob rather than a growable collection needing its own CRUD.
 */
export const SCENE_COUNT = 64
export const SLOTS_PER_SCENE = 8

export interface Scene {
  /** 0-63, redundant with array position but keeps a Scene self-describing when passed around. */
  index: number
  name: string
  /** Exactly SLOTS_PER_SCENE entries. A value is a presetStore id; null is an empty slot. */
  slots: (string | null)[]
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
