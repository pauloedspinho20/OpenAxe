import { beforeEach, describe, expect, it } from 'vitest'
import { clearStore, STORE_MIDI } from '../storage/db'
import { kvPut } from '../storage/kv'
import {
  DEFAULT_MIDI_CONFIG,
  clearMidiConfig,
  loadMidiConfig,
  saveMidiConfig,
  type MidiConfig,
} from './midiConfigStore'

beforeEach(async () => {
  await clearStore(STORE_MIDI)
})

describe('midiConfigStore', () => {
  it('returns the default config when nothing has been saved', async () => {
    expect(await loadMidiConfig()).toEqual(DEFAULT_MIDI_CONFIG)
  })

  it('round-trips a config', async () => {
    const config: MidiConfig = {
      id: 'midi-config',
      version: 2,
      selectedInputId: 'in-1',
      mappings: [
        {
          id: 'm1',
          match: { type: 'pc', channel: 0, number: 0 },
          action: { kind: 'slot', slot: 0 },
        },
      ],
    }
    await saveMidiConfig(config)
    expect(await loadMidiConfig()).toEqual(config)
  })

  it('migrates a v1 row (predates knob mappings) to v2 on load', async () => {
    await kvPut(STORE_MIDI, {
      id: 'midi-config',
      version: 1,
      selectedInputId: null,
      mappings: [],
    })
    expect(await loadMidiConfig()).toEqual({ ...DEFAULT_MIDI_CONFIG })
  })

  it('clearMidiConfig restores the default on next load', async () => {
    await saveMidiConfig({ ...DEFAULT_MIDI_CONFIG, selectedInputId: 'in-1' })
    await clearMidiConfig()
    expect(await loadMidiConfig()).toEqual(DEFAULT_MIDI_CONFIG)
  })
})
