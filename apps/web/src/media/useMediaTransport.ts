import { useEffect } from 'react'

import type { GraphRig } from '../engine/GraphRig'
import { getOpenAxe, getShellKind } from '../native/openaxe'
import { useMediaStore, type AnalyserLike } from './mediaStore'
import { createBridgeTransport, createWorkletTransport } from './transport'

/**
 * Binds the media store to the running engine: the rig worklet's player on
 * the web, the native bridge on desktop. The plugin shell has no media
 * center (the DAW is the transport there).
 */
export function useMediaTransport(
  rig: unknown,
  context: AudioContext | null,
  ready: boolean,
  inputAnalyser: AnalyserLike | null = null,
) {
  useEffect(() => {
    const store = useMediaStore.getState()
    if (!ready) {
      store.setTransport(null)
      return
    }
    const shell = getShellKind()
    if (shell === 'plugin') return
    if (shell === 'desktop') {
      const bridge = getOpenAxe()
      if (!bridge) return
      const transport = createBridgeTransport(bridge)
      store.setTransport(transport)
      void bridge
        .getConfig()
        .then((cfg) => {
          if (cfg.sampleRate > 0) useMediaStore.setState({ engineRate: cfg.sampleRate })
        })
        .catch(() => {})
      return () => useMediaStore.getState().setTransport(null)
    }
    const port = (rig as GraphRig | null)?.playerPort
    if (!port) return
    store.setTransport(createWorkletTransport(port), context?.sampleRate)
    return () => useMediaStore.getState().setTransport(null)
  }, [rig, context, ready])

  useEffect(() => {
    void useMediaStore.getState().loadLibrary()
  }, [])

  // Wait mode listens to the guitar through the tuner's input analyser.
  useEffect(() => {
    useMediaStore.setState({ inputAnalyser })
  }, [inputAnalyser])
}

export function mediaCenterAvailable(): boolean {
  return getShellKind() !== 'plugin'
}
