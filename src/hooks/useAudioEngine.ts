import { useCallback, useRef, useState } from 'react'
import { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { DualChainRig } from '../engine/DualChainRig'
import { bindDualChainRig } from '../engine/bindDualChainRig'
import { useDualChainStore } from '../state/dualChainStore'

export type EngineStatus = 'off' | 'starting' | 'ready' | 'error'

export interface AudioEngineState {
  status: EngineStatus
  error: string | null
  rig: DualChainRig | null
  context: AudioContext | null
  analyser: AnalyserNode | null
  /** False if the user denied mic access (or none exists) - the rig still powers on either way. */
  micGranted: boolean
}

const IDLE_STATE: AudioEngineState = {
  status: 'off',
  error: null,
  rig: null,
  context: null,
  analyser: null,
  micGranted: false,
}

/**
 * Owns the AudioContext/engine/rig lifecycle behind an explicit power-on
 * interaction - browsers require a user gesture to start an AudioContext
 * anyway, so this doubles as the "ask for the mic" moment rather than
 * surprising the user with a permission prompt on page load.
 */
export function useAudioEngine() {
  const [state, setState] = useState<AudioEngineState>(IDLE_STATE)
  const startingRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const powerOn = useCallback(async () => {
    if (startingRef.current || state.status === 'ready') return
    startingRef.current = true
    setState((s) => ({ ...s, status: 'starting', error: null }))

    try {
      const context = new AudioContext()
      const engine = await NamEngine.attach(context)
      const rig = await DualChainRig.create(context, engine)
      unbindRef.current = bindDualChainRig(useDualChainStore, rig)

      const analyser = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
      rig.outputNode.connect(analyser)
      analyser.connect(context.destination)

      // The engine is usable the moment the rig exists - don't make "ready"
      // wait on the mic permission prompt, which the user (or a sandboxed
      // environment) might never answer. Connect the mic in the background
      // and just flip micGranted on when/if it resolves.
      setState({ status: 'ready', error: null, rig, context, analyser, micGranted: false })

      navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        .then((stream) => {
          streamRef.current = stream
          const source = context.createMediaStreamSource(stream)
          sourceRef.current = source
          rig.connectInput(source, 'mono-to-both')
          setState((s) => (s.context === context ? { ...s, micGranted: true } : s))
        })
        .catch((micError: unknown) => {
          console.warn('[useAudioEngine] microphone unavailable:', micError)
        })
    } catch (error) {
      setState({
        ...IDLE_STATE,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      startingRef.current = false
    }
  }, [state.status])

  const powerOff = useCallback(async () => {
    unbindRef.current?.()
    unbindRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    state.analyser?.disconnect()
    await state.rig?.dispose()
    await state.context?.close()
    setState(IDLE_STATE)
  }, [state.rig, state.context, state.analyser])

  return { ...state, powerOn, powerOff }
}
