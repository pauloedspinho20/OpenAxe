import { SceneNavigator } from '../scenes/sceneNavigator'
import type { MidiAction } from './actions'
import { applyMidiParamValue } from './params'

/** Runs a matched action against the live scene navigator. Never throws - SceneNavigator itself never does. */
export function executeMidiAction(action: MidiAction): void {
  switch (action.kind) {
    case 'slot':
      void SceneNavigator.goToSlot(action.slot, { source: 'midi' })
      break
    case 'scene':
      void SceneNavigator.goToScene(action.scene, { source: 'midi' })
      break
    case 'nextScene':
      void SceneNavigator.nextScene({ source: 'midi' })
      break
    case 'prevScene':
      void SceneNavigator.prevScene({ source: 'midi' })
      break
    case 'param':
      // Discrete dispatch has no CC value to map - the live path in
      // midiAccess calls executeMidiParamAction directly. Reaching here
      // would be a programming error, so do nothing rather than guess.
      break
  }
}

/**
 * Continuous path for mapped knobs: one incoming 7-bit CC value onto one
 * param. False when the mapped target no longer exists (block removed or
 * param renamed) - orphaned mappings are silent no-ops.
 */
export function executeMidiParamAction(
  blockId: string,
  paramKey: string,
  midiValue: number,
): boolean {
  return applyMidiParamValue(blockId, paramKey, midiValue)
}
