import { useCallback, useEffect, useRef, useState } from 'react'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'
import type { EngineStatus } from '../hooks/useAudioEngine'
import { NativeGraphRig } from '../native/NativeGraphRig'
import { NativeAnalyser } from '../native/NativeAnalyser'
import { NativeAudioContext } from '../native/NativeAudioContext'
import { getNamStudio, type NamStudioBridge } from '../native/namStudio'

export interface NativeAudioEngineState {
  status: EngineStatus
  error: string | null
  rig: NativeGraphRig | null
  context: NativeAudioContext | null
  analyser: NativeAnalyser | null
  tunerAnalyser: NativeAnalyser | null
  micGranted: boolean
}

const IDLE: NativeAudioEngineState = {
  status: 'off',
  error: null,
  rig: null,
  context: null,
  analyser: null,
  tunerAnalyser: null,
  micGranted: false,
}

const LATENCY_BUFFER: Record<string, number> = { interactive: 128, balanced: 256, playback: 512 }
const TAP_FRAMES = 4096
const SAMPLE_RATE = 48000
const DEFAULT_DEVICE = 0xffffffff

/**
 * Native variant of useAudioEngine for the desktop shell (issue #15 M3): the
 * DSP runs in the C++ core through window.namStudio - no Web Audio at all.
 * Keeps the same AudioEngineState shape so App.tsx and the component tree are
 * reused verbatim. The `context`/`analyser`/`tunerAnalyser` values are plain-JS
 * shims (NativeAudioContext / NativeAnalyser) fed from the C++ monitor taps, so
 * meters and the tuner show real native audio with no AudioContext.
 */
export function useNativeAudioEngine() {
  const [state, setState] = useState<NativeAudioEngineState>(IDLE)
  const startingRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const rigRef = useRef<NativeGraphRig | null>(null)
  const bridgeRef = useRef<NamStudioBridge | null>(null)
  const inputTapRef = useRef<Float32Array>(new Float32Array(0))
  const outputTapRef = useRef<Float32Array>(new Float32Array(0))
  const pollIntervalRef = useRef<number | null>(null)

  // While the engine is running, keep the analysers fed from the latest native
  // taps and drive block meters from the core's real peaks.
  useEffect(() => {
    if (state.status !== 'ready' || !bridgeRef.current || !rigRef.current) return
    const bridge = bridgeRef.current
    const rig = rigRef.current

    const poll = () => {
      void bridge
        .getTap({ side: 'in', frames: TAP_FRAMES })
        .then((t) => {
          inputTapRef.current = new Float32Array(t.l)
        })
        .catch(() => {})
      void bridge
        .getTap({ side: 'out', frames: TAP_FRAMES })
        .then((t) => {
          outputTapRef.current = new Float32Array(t.l)
        })
        .catch(() => {})
      void bridge
        .meters()
        .then((meters) => {
          for (const m of meters) rig.updateMeter(m.id, m.value)
        })
        .catch(() => {})
    }
    poll()
    pollIntervalRef.current = window.setInterval(poll, 50)
    return () => {
      if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [state.status])

  const powerOn = useCallback(async () => {
    if (startingRef.current || state.status === 'ready') return
    const bridge = getNamStudio()
    if (!bridge) {
      setState({ ...IDLE, status: 'error', error: 'Native audio bridge unavailable' })
      return
    }
    startingRef.current = true
    setState((s) => ({ ...s, status: 'starting', error: null }))

    try {
      const io = useIOStore.getState()
      const rig = new NativeGraphRig(bridge)
      rigRef.current = rig
      bridgeRef.current = bridge
      unbindRef.current = bindGraphRig(useGraphStore, rig)

      // Open + start the native duplex stream (default devices unless chosen).
      const opened = await bridge.open({
        inputDeviceId: io.inputDeviceId ? Number(io.inputDeviceId) : DEFAULT_DEVICE,
        outputDeviceId: io.outputDeviceId ? Number(io.outputDeviceId) : DEFAULT_DEVICE,
        sampleRate: SAMPLE_RATE,
        bufferFrames: LATENCY_BUFFER[io.latencyHint] ?? 128,
      })
      if (!opened.ok) throw new Error(opened.error ?? 'failed to open audio device')
      const started = await bridge.start()
      if (!started.ok) throw new Error(started.error ?? 'failed to start audio')

      // Web-Audio-free analysers + context shim fed from the C++ taps.
      const context = new NativeAudioContext(SAMPLE_RATE)
      const analyser = new NativeAnalyser({
        fftSize: 256,
        sampleRate: SAMPLE_RATE,
        read: () => outputTapRef.current,
      })
      // Large fftSize: the tuner's autocorrelation needs a wide window to
      // resolve low bass (~31Hz needs >1500 samples per cycle at 48kHz).
      const tunerAnalyser = new NativeAnalyser({
        fftSize: 4096,
        sampleRate: SAMPLE_RATE,
        read: () => inputTapRef.current,
      })

      setState({
        status: 'ready',
        error: null,
        rig,
        context,
        analyser,
        tunerAnalyser,
        micGranted: true, // native input is always available (device, not permission)
      })
    } catch (error) {
      setState({
        ...IDLE,
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
    inputTapRef.current = new Float32Array(0)
    outputTapRef.current = new Float32Array(0)
    const bridge = bridgeRef.current
    bridgeRef.current = null
    if (bridge) {
      await bridge.stop().catch(() => {})
      await bridge.close().catch(() => {})
    }
    await rigRef.current?.dispose()
    rigRef.current = null
    setState(IDLE)
  }, [])

  return { ...state, powerOn, powerOff }
}
