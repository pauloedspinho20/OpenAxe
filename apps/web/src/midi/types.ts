/**
 * 0-based everywhere in here (channel 0-15, slot 0-7, scene 0-63) - the one
 * place 1-based conversion happens is message.ts's formatMidiMatch and
 * actions.ts's actionLabel, at the render boundary.
 */
export type MidiMessageType = 'noteon' | 'cc' | 'pc'

/** A decoded incoming message - includes velocity/value, which matching ignores (see message.ts). */
export interface MidiMessage {
  type: MidiMessageType
  channel: number
  number: number
  value: number
}

/** What a mapping matches on - value/velocity deliberately excluded, see message.ts. */
export interface MidiMatch {
  type: MidiMessageType
  channel: number
  number: number
}

export interface MidiInputInfo {
  id: string
  name: string
}
