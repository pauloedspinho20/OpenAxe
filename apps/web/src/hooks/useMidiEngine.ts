import { useEffect } from 'react'
import { autoConnectIfPermitted, isMidiSupported } from '../midi/midiAccess'
import { useMidiStore } from '../state/midiStore'

/**
 * Mounted once in App.tsx. Loads the persisted mapping config and silently
 * reconnects if the user already granted MIDI access in a past session.
 * Dispatch itself needs no wiring here - midiAccess.ts calls
 * executeMidiAction (see dispatch.ts) directly against the SceneNavigator
 * singleton, which already holds the live rig/context via useSceneEngine.
 */
export function useMidiEngine(): void {
  useEffect(() => {
    void useMidiStore.getState().loadConfig()
  }, [])

  useEffect(() => {
    useMidiStore.getState().setSupported(isMidiSupported())
    void autoConnectIfPermitted()
  }, [])
}
