import type { MidiMatch, MidiMessage, MidiMessageType } from './types'

/**
 * Decodes a raw Web MIDI message into a discrete-trigger shape, or null for
 * anything not usable as one. System messages (clock 0xF8, active sensing
 * 0xFE, sysex 0xF0+) are filtered first and deliberately - hardware streams
 * these continuously, so filtering them before anything else is what stops
 * Learn mode from capturing a clock byte the instant it's armed. Note-off
 * (0x8n) and velocity-0 note-on (the running-status note-off convention)
 * are dropped too, along with pitch bend/aftertouch (0xAn/0xDn/0xEn).
 */
export function parseMidiMessage(data: Uint8Array | null | undefined): MidiMessage | null {
  if (!data || data.length < 2) return null
  const status = data[0]
  if (status === undefined || status < 0x80) return null
  if (status >= 0xf0) return null // system messages: clock, active sensing, sysex, etc.

  const kind = status & 0xf0
  const channel = status & 0x0f
  const number = data[1]
  if (number === undefined) return null

  if (kind === 0x90) {
    const value = data[2] ?? 0
    if (value === 0) return null // note-on velocity 0 == note-off, by convention
    return { type: 'noteon', channel, number, value }
  }
  if (kind === 0xb0) {
    return { type: 'cc', channel, number, value: data[2] ?? 0 }
  }
  if (kind === 0xc0) {
    return { type: 'pc', channel, number, value: 0 }
  }
  return null // note-off (0x80), aftertouch (0xA0/0xD0), pitch bend (0xE0)
}

/**
 * Whether this message counts as a "press" for learn/dispatch purposes.
 * PC and note-on always do (their `number` alone identifies the control).
 * CC only counts above the halfway point - a momentary-footswitch CC sends
 * 127 on press and 0 on release, and without this gate every press would
 * fire twice.
 */
export function isTriggerEdge(message: MidiMessage): boolean {
  if (message.type === 'cc') return message.value >= 64
  return true
}

/** Stable string identity for a match - dedup key and React key. */
export function matchKey(match: MidiMatch): string {
  return `${match.type}:${match.channel}:${match.number}`
}

/** Matching deliberately ignores value/velocity - see the module doc comment above. */
export function messageMatches(message: MidiMessage, match: MidiMatch): boolean {
  return (
    message.type === match.type &&
    message.channel === match.channel &&
    message.number === match.number
  )
}

const TYPE_LABEL: Record<MidiMessageType, string> = { noteon: 'Note', cc: 'CC', pc: 'PC' }

/** 1-based channel display, e.g. "PC 0 (ch 1)" / "CC 20 (ch 1)" / "Note 36 (ch 10)". */
export function formatMidiMatch(match: MidiMatch): string {
  return `${TYPE_LABEL[match.type]} ${match.number} (ch ${match.channel + 1})`
}
