import { SceneNavigator } from '../scenes/sceneNavigator'
import type { MidiAction } from './actions'

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
  }
}
