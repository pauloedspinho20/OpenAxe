/**
 * Persistence for the MIDI mapping config - a single row (the
 * whole config is at most ~80 tiny objects, always read/written as a unit),
 * mirroring presetStore.ts's thin-CRUD style.
 */
import { STORE_MIDI } from '../storage/db'
import { kvDelete, kvGet, kvPut } from '../storage/kv'
import type { MidiAction } from './actions'
import type { MidiMatch } from './types'

export interface MidiMapping {
  id: string
  match: MidiMatch
  action: MidiAction
}

export interface MidiConfig {
  id: 'midi-config'
  version: typeof MIDI_CONFIG_VERSION
  /** null = listen to all connected inputs. */
  selectedInputId: string | null
  mappings: MidiMapping[]
}

const MIDI_CONFIG_ID = 'midi-config'

/**
 * 2 = param (knob) mappings exist alongside the original discrete
 * slot/scene triggers. The mapping shape itself never changed, so a v1 row
 * migrates by stamping the new version on load.
 */
export const MIDI_CONFIG_VERSION = 2 as const

export const DEFAULT_MIDI_CONFIG: MidiConfig = {
  id: MIDI_CONFIG_ID,
  version: MIDI_CONFIG_VERSION,
  selectedInputId: null,
  mappings: [],
}

/** v1 rows predate knob mappings - same shape, older version stamp. */
type StoredMidiConfig = MidiConfig | (Omit<MidiConfig, 'version'> & { version: 1 })

export async function loadMidiConfig(): Promise<MidiConfig> {
  const result = await kvGet<StoredMidiConfig>(STORE_MIDI, MIDI_CONFIG_ID)
  if (!result) return DEFAULT_MIDI_CONFIG
  if (result.version === 1) return { ...result, version: MIDI_CONFIG_VERSION }
  return result
}

export async function saveMidiConfig(config: MidiConfig): Promise<void> {
  await kvPut(STORE_MIDI, config)
}

export async function clearMidiConfig(): Promise<void> {
  await kvDelete(STORE_MIDI, MIDI_CONFIG_ID)
}
