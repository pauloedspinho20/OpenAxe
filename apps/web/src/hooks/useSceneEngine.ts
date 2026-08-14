import { useEffect, useRef } from 'react'
import type { GraphRig } from '../engine/GraphRig'
import type { EngineStatus } from './useAudioEngine'
import { SceneNavigator } from '../scenes/sceneNavigator'
import { useSceneStore } from '../state/sceneStore'

/**
 * The one React<->SceneNavigator seam: registers the live rig/context with
 * the navigator singleton whenever the engine powers on/off, and restores
 * whatever scene/slot was active the moment the engine first comes up in
 * this session (once, keyed off the AudioContext identity so power-off then
 * back on restores again).
 */
export function useSceneEngine(
  rig: GraphRig | null,
  context: AudioContext | null,
  status: EngineStatus,
): void {
  const hydrated = useSceneStore((s) => s.hydrated)
  const restoredForRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    SceneNavigator.setTarget(rig && context ? { rig, context } : null)
    return () => SceneNavigator.setTarget(null)
  }, [rig, context])

  useEffect(() => {
    if (status !== 'ready' || !hydrated || !context) return
    if (restoredForRef.current === context) return
    restoredForRef.current = context
    void SceneNavigator.reloadActive({ source: 'boot' })
  }, [status, context, hydrated])
}
