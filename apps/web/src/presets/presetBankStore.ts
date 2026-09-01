/**
 * Persistence for the preset bank - a single row (see presetBank.ts
 * for why one blob rather than 512 rows), mirroring sceneBankStore.ts's
 * thin-CRUD style. Shares the app's one database via storage/db.ts.
 */
import { STORE_PRESET_BANK } from '../storage/db'
import { kvDelete, kvGet, kvPut } from '../storage/kv'
import { PRESET_SLOT_COUNT, type PresetBank } from './presetBank'

const PRESET_BANK_ID = 'default'

export async function savePresetBank(bank: PresetBank): Promise<void> {
  await kvPut(STORE_PRESET_BANK, bank)
}

/** Read the preset bank, normalizing whatever's stored - null if nothing's been saved yet. */
export async function loadPresetBank(): Promise<PresetBank | null> {
  const result = await kvGet<PresetBank>(STORE_PRESET_BANK, PRESET_BANK_ID)
  return result ? normalizePresetBank(result) : null
}

export async function clearPresetBank(): Promise<void> {
  await kvDelete(STORE_PRESET_BANK, PRESET_BANK_ID)
}

/** A fresh bank: every one of the 512 slots empty. */
export function createEmptyPresetBank(): PresetBank {
  return {
    id: PRESET_BANK_ID,
    version: 1,
    slots: Array.from({ length: PRESET_SLOT_COUNT }, () => null),
    updatedAt: 0,
  }
}

/**
 * Defensively pads/truncates the slots array and keeps only string (preset-id)
 * values - this is a persisted structure the UI indexes blindly (slots[i]),
 * so a corrupt or older-shape record must not crash the app on boot. Returns
 * null only if `raw` isn't even object-shaped.
 */
export function normalizePresetBank(raw: unknown): PresetBank | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<PresetBank>
  const rawSlots = Array.isArray(r.slots) ? r.slots : []
  return {
    id: 'default',
    version: 1,
    slots: Array.from({ length: PRESET_SLOT_COUNT }, (_, i) =>
      typeof rawSlots[i] === 'string' ? (rawSlots[i] as string) : null,
    ),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}
