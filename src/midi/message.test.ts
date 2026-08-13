// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  formatMidiMatch,
  isTriggerEdge,
  matchKey,
  messageMatches,
  parseMidiMessage,
} from './message'

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b)
}

describe('parseMidiMessage', () => {
  it('decodes note-on', () => {
    expect(parseMidiMessage(bytes(0x90, 60, 100))).toEqual({
      type: 'noteon',
      channel: 0,
      number: 60,
      value: 100,
    })
  })

  it('extracts the channel from the low nibble', () => {
    expect(parseMidiMessage(bytes(0x99, 60, 100))?.channel).toBe(9)
  })

  it('decodes CC', () => {
    expect(parseMidiMessage(bytes(0xb0, 20, 127))).toEqual({
      type: 'cc',
      channel: 0,
      number: 20,
      value: 127,
    })
  })

  it('decodes PC (2-byte, no value byte)', () => {
    expect(parseMidiMessage(bytes(0xc0, 5))).toEqual({
      type: 'pc',
      channel: 0,
      number: 5,
      value: 0,
    })
  })

  it('returns null for note-off', () => {
    expect(parseMidiMessage(bytes(0x80, 60, 0))).toBeNull()
  })

  it('returns null for note-on with velocity 0 (running-status note-off)', () => {
    expect(parseMidiMessage(bytes(0x90, 60, 0))).toBeNull()
  })

  it('returns null for clock', () => {
    expect(parseMidiMessage(bytes(0xf8))).toBeNull()
  })

  it('returns null for active sensing', () => {
    expect(parseMidiMessage(bytes(0xfe))).toBeNull()
  })

  it('returns null for sysex', () => {
    expect(parseMidiMessage(bytes(0xf0, 0x7e, 0x00, 0xf7))).toBeNull()
  })

  it('returns null for pitch bend and aftertouch', () => {
    expect(parseMidiMessage(bytes(0xe0, 0, 64))).toBeNull()
    expect(parseMidiMessage(bytes(0xa0, 60, 100))).toBeNull()
    expect(parseMidiMessage(bytes(0xd0, 100))).toBeNull()
  })

  it('returns null for short or missing data', () => {
    expect(parseMidiMessage(bytes(0x90))).toBeNull()
    expect(parseMidiMessage(null)).toBeNull()
    expect(parseMidiMessage(undefined)).toBeNull()
  })
})

describe('isTriggerEdge', () => {
  it('CC counts as a press only at 64 and above', () => {
    expect(isTriggerEdge({ type: 'cc', channel: 0, number: 1, value: 0 })).toBe(false)
    expect(isTriggerEdge({ type: 'cc', channel: 0, number: 1, value: 63 })).toBe(false)
    expect(isTriggerEdge({ type: 'cc', channel: 0, number: 1, value: 64 })).toBe(true)
    expect(isTriggerEdge({ type: 'cc', channel: 0, number: 1, value: 127 })).toBe(true)
  })

  it('PC and note-on always count', () => {
    expect(isTriggerEdge({ type: 'pc', channel: 0, number: 1, value: 0 })).toBe(true)
    expect(isTriggerEdge({ type: 'noteon', channel: 0, number: 1, value: 1 })).toBe(true)
  })
})

describe('messageMatches', () => {
  it('matches on type/channel/number and ignores value', () => {
    const match = { type: 'cc' as const, channel: 0, number: 20 }
    expect(messageMatches({ type: 'cc', channel: 0, number: 20, value: 1 }, match)).toBe(true)
    expect(messageMatches({ type: 'cc', channel: 0, number: 20, value: 127 }, match)).toBe(true)
    expect(messageMatches({ type: 'cc', channel: 0, number: 21, value: 1 }, match)).toBe(false)
    expect(messageMatches({ type: 'pc', channel: 0, number: 20, value: 0 }, match)).toBe(false)
  })
})

describe('matchKey', () => {
  it('is unique per type/channel/number', () => {
    expect(matchKey({ type: 'cc', channel: 0, number: 1 })).not.toBe(
      matchKey({ type: 'cc', channel: 1, number: 1 }),
    )
  })
})

describe('formatMidiMatch', () => {
  it('renders 1-based channel/PC strings', () => {
    expect(formatMidiMatch({ type: 'pc', channel: 0, number: 0 })).toBe('PC 0 (ch 1)')
    expect(formatMidiMatch({ type: 'cc', channel: 0, number: 20 })).toBe('CC 20 (ch 1)')
    expect(formatMidiMatch({ type: 'noteon', channel: 9, number: 36 })).toBe('Note 36 (ch 10)')
  })
})
