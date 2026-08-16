import { useCallback, useEffect, useRef, useState } from 'react'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'
import type { EngineStatus } from '../hooks/useAudioEngine'
import { NativeGraphRig } from '../native/NativeGraphRig'
import { getNamStudio, type NamStudioBridge, type NamStudioTap } from '../native/namStudio'

export interface NativeAudioEngineState {
  status: EngineStatus
  error: string | null
  rig: NativeGraphRig | null
  context: AudioContext | null
  analyser: AnalyserNode | null
  tunerAnalyser: AnalyserNode | null
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
const DEFAULT_DEVICE = 0xffffffff

interface TapFeeder {
  analyser: AnalyserNode
  stop: () => void
}

/**
 * A facade ScriptProcessor sink that pumps arbitrary float frames (here, the
 * C++ side's monitor taps) into an AnalyserNode so the existing meter/tuner
 * widgets see real native audio. Connected to destination through a zero-gain
 * node so it renders (onaudioprocess fires) without producing audible output -
 * the real output is the RtAudio device, not Web Audio. ScriptProcessor is
 * deprecated but is the simplest way to push samples into the graph without a
 * custom AudioWorklet; it's UI-only and never in the audio path.
 */
function createTapFeeder(
  context: AudioContext,
  fftSize: number,
  getSamples: () => { l: Float32Array; r: Float32Array; frames: number },
): TapFeeder {
  const analyser = new AnalyserNode(context, { fftSize, smoothingTimeConstant: 0 })
  const processor = context.createScriptProcessor(2048, 0, 2)
  processor.onaudioprocess = (e) => {
    const outL = e.outputBuffer.getChannelData(0)
    const outR = e.outputBuffer.getChannelData(1)
    const s = getSamples()
    const n = Math.min(outL.length, s.l.length, s.frames)
    for (let i = 0; i < n; i++) {
      outL[i] = s.l[i] ?? 0
      outR[i] = s.r[i] ?? 0
    }
    for (let i = n; i < outL.length; i++) {
      outL[i] = 0
      outR[i] = 0
    }
  }
  processor.connect(analyser)
  const silence = new GainNode(context, { gain: 0 })
  analyser.connect(silence)
  silence.connect(context.destination)
  return {
    analyser,
    stop() {
      processor.onaudioprocess = null
      processor.disconnect()
      analyser.disconnect()
      silence.disconnect()
    },
  }
}

/**
 * Native variant of useAudioEngine for the desktop shell (issue #15 M3): the
 * DSP runs in the C++ core through window.namStudio, not Web Audio. Keeps the
 * same AudioEngineState shape so App.tsx and the component tree are reused
 * verbatim. A facade AudioContext exists purely for analysers (meters/tuner)
 * and decodeAudioData; its destination is silenced.
 */
export function useNativeAudioEngine() {
  const [state, setState] = useState<NativeAudioEngineState>(IDLE)
  const startingRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rigRef = useRef<NativeGraphRig | null>(null)
  const bridgeRef = useRef<NamStudioBridge | null>(null)
  const feedersRef = useRef<TapFeeder[]>([])
  const outputTapRef = useRef<NamStudioTap>({ l: [], r: [], frames: 0 })
  const inputTapRef = useRef<NamStudioTap>({ l: [], r: [], frames: 0 })
  const pollerRef = useRef<number | null>(null)
  const meterIntervalRef = useRef<number | null>(null)

  // Keep the analysers fed from the latest native taps, and update block
  // meters from the core's real peaks, while the engine is running.
  useEffect(() => {
    if (state.status !== 'ready' || !bridgeRef.current || !rigRef.current) return
    const bridge = bridgeRef.current
    const rig = rigRef.current

    const poll = () => {
      void bridge
        .getTap({ side: 'in', frames: TAP_FRAMES })
        .then((t) => {
          inputTapRef.current = t
        })
        .catch(() => {})
      void bridge
        .getTap({ side: 'out', frames: TAP_FRAMES })
        .then((t) => {
          outputTapRef.current = t
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
    pollerRef.current = window.setInterval(poll, 50)
    meterIntervalRef.current = window.setInterval(() => {
      void bridge
        .meters()
        .then((meters) => {
          for (const m of meters) rig.updateMeter(m.id, m.value)
        })
        .catch(() => {})
    }, 100)
    return () => {
      if (pollerRef.current !== null) window.clearInterval(pollerRef.current)
      if (meterIntervalRef.current !== null) window.clearInterval(meterIntervalRef.current)
      pollerRef.current = null
      meterIntervalRef.current = null
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
      const context = new AudioContext({ latencyHint: io.latencyHint })
      const rig = new NativeGraphRig(bridge, context)
      contextRef.current = context
      rigRef.current = rig
      bridgeRef.current = bridge
      unbindRef.current = bindGraphRig(useGraphStore, rig)

      // Open + start the native duplex stream (default devices unless chosen).
      const opened = await bridge.open({
        inputDeviceId: io.inputDeviceId ? Number(io.inputDeviceId) : DEFAULT_DEVICE,
        outputDeviceId: io.outputDeviceId ? Number(io.outputDeviceId) : DEFAULT_DEVICE,
        sampleRate: 48000,
        bufferFrames: LATENCY_BUFFER[io.latencyHint] ?? 128,
      })
      if (!opened.ok) throw new Error(opened.error ?? 'failed to open audio device')
      const started = await bridge.start()
      if (!started.ok) throw new Error(started.error ?? 'failed to start audio')

      // Facade analysers fed from the native taps (real signal, silent output).
      const outputFeeder = createTapFeeder(context, 256, () => ({
        l: new Float32Array(outputTapRef.current.l),
        r: new Float32Array(outputTapRef.current.r),
        frames: outputTapRef.current.frames,
      }))
      const tunerFeeder = createTapFeeder(context, 4096, () => ({
        l: new Float32Array(inputTapRef.current.l),
        r: new Float32Array(inputTapRef.current.r),
        frames: inputTapRef.current.frames,
      }))
      feedersRef.current = [outputFeeder, tunerFeeder]

      setState({
        status: 'ready',
        error: null,
        rig,
        context,
        analyser: outputFeeder.analyser,
        tunerAnalyser: tunerFeeder.analyser,
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
    for (const feeder of feedersRef.current) feeder.stop()
    feedersRef.current = []
    outputTapRef.current = { l: [], r: [], frames: 0 }
    inputTapRef.current = { l: [], r: [], frames: 0 }
    const bridge = bridgeRef.current
    bridgeRef.current = null
    if (bridge) {
      await bridge.stop().catch(() => {})
      await bridge.close().catch(() => {})
    }
    await rigRef.current?.dispose()
    rigRef.current = null
    await contextRef.current?.close()
    contextRef.current = null
    setState(IDLE)
  }, [])

  return { ...state, powerOn, powerOff }
}
