/**
 * The closed set of actions a mapping can target. "Any incoming MIDI
 * message can be learned and bound to any slot/scene action" means the
 * *message* side is free-form (learned); the action side is this fixed set
 * of kinds.
 */
export type MidiAction =
  | { kind: 'slot'; slot: number } // 0-7, whatever scene is current
  | { kind: 'scene'; scene: number } // 0-63, absolute jump
  | { kind: 'nextScene' }
  | { kind: 'prevScene' }

/** Stable string identity - the learn-in-progress marker and the one-binding-per-action rule. */
export function actionKey(action: MidiAction): string {
  switch (action.kind) {
    case 'slot':
      return `slot:${action.slot}`
    case 'scene':
      return `scene:${action.scene}`
    case 'nextScene':
      return 'nextScene'
    case 'prevScene':
      return 'prevScene'
  }
}

/** 1-based display text. */
export function actionLabel(action: MidiAction): string {
  switch (action.kind) {
    case 'slot':
      return `Slot ${action.slot + 1}`
    case 'scene':
      return `Scene ${action.scene + 1}`
    case 'nextScene':
      return 'Next Scene'
    case 'prevScene':
      return 'Previous Scene'
  }
}
