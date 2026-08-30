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
  version: 1
  /** null = listen to all connected inputs. */
  selectedInputId: string | null
  mappings: MidiMapping[]
}

const MIDI_CONFIG_ID = 'midi-config'

export const DEFAULT_MIDI_CONFIG: MidiConfig = {
  id: MIDI_CONFIG_ID,
  version: 1,
  selectedInputId: null,
  mappings: [],
}

export async function loadMidiConfig(): Promise<MidiConfig> {
  const result = await kvGet<MidiConfig>(STORE_MIDI, MIDI_CONFIG_ID)
  return result ?? DEFAULT_MIDI_CONFIG
}

export async function saveMidiConfig(config: MidiConfig): Promise<void> {
  await kvPut(STORE_MIDI, config)
}

export async function clearMidiConfig(): Promise<void> {
  await kvDelete(STORE_MIDI, MIDI_CONFIG_ID)
}
