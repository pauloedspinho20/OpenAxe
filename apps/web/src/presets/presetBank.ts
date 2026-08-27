/**
 * A "preset bank" is a fixed set of 512 preset slots - the same
 * hardware-pedalboard-bank-and-patch idiom as the scene bank, but one level
 * down: the user *places* presets into bank slots, and each scene slot
 * references a bank slot by number (see scenes/types.ts). Fixed count (not
 * user-creatable/deletable) so the whole thing is one small, always-valid
 * blob rather than a growable collection needing its own CRUD.
 */
export const PRESET_SLOT_COUNT = 512

export interface PresetBank {
  /** Singleton row key - there is exactly one bank per browser. */
  id: 'default'
  /** Blob schema version, independent of storage/db.ts's DB_VERSION - lets normalizePresetBank migrate in place. */
  version: 1
  /** Exactly PRESET_SLOT_COUNT entries. A value is a presetStore id; null is an empty slot. */
  slots: (string | null)[]
  updatedAt: number
}
