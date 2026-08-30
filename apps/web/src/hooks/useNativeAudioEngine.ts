import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@openaxe/ui'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'
import type { EngineStatus } from '../hooks/useAudioEngine'
import { NativeGraphRig } from '../native/NativeGraphRig'
import { NativeAnalyser } from '../native/NativeAnalyser'
import { NativeAudioContext } from '../native/NativeAudioContext'
import {
  getOpenAxe,
  getShellKind,
  shellOwnsAudioDevice,
  type OpenAxeBridge,
} from '../native/openaxe'

export interface NativeAudioEngineState {
  status: EngineStatus
  error: string | null
  rig: NativeGraphRig | null
  context: NativeAudioContext | null
  analyser: NativeAnalyser | null
  tunerAnalyser: NativeAnalyser | null
  micGranted: boolean
  /** True once the user chose "Continue without sound" - no stream is open, the
   * rig exists for editing only. Cleared automatically the moment a duplex
   * device is found and the stream opens for real - see the recovery effect. */
  noSound: boolean
}

export interface NativeAudioEnginePowerOnOptions {
  /** Skip opening/starting the RtAudio stream - build the rig for editing only. */
  noSound?: boolean
}

const IDLE: NativeAudioEngineState = {
  status: 'off',
  error: null,
  rig: null,
  context: null,
  analyser: null,
  tunerAnalyser: null,
  micGranted: false,
  noSound: false,
}

const LATENCY_BUFFER: Record<string, number> = { interactive: 128, balanced: 256, playback: 512 }
const TAP_FRAMES = 4096
const SAMPLE_RATE = 48000
const DEFAULT_DEVICE = 0xffffffff
/** How often to re-scan for a usable device while in no-sound mode. */
const DEVICE_RECOVERY_INTERVAL_MS = 3000

/** Resolve a persisted device id ("", or a numeric id as a string) to the
 * number the C++ core expects - 0xffffffff means "let the backend pick the
 * platform default" (see audio.cpp's Open()). */
function resolveDeviceId(id: string): number {
  return id ? Number(id) : DEFAULT_DEVICE
}

/**
 * Native variant of useAudioEngine for the desktop shell (issue #15 M3): the
 * DSP runs in the C++ core through window.openAxe - no Web Audio at all.
 * Keeps the same AudioEngineState shape so App.tsx and the component tree are
 * reused verbatim. The `context`/`analyser`/`tunerAnalyser` values are plain-JS
 * shims (NativeAudioContext / NativeAnalyser) fed from the C++ monitor taps, so
 * meters and the tuner show real native audio with no AudioContext.
 */
export function useNativeAudioEngine() {
  const [state, setState] = useState<NativeAudioEngineState>(IDLE)
  const startingRef = useRef(false)
  const recoveringRef = useRef(false)
  const handlingStreamErrorRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const rigRef = useRef<NativeGraphRig | null>(null)
  const bridgeRef = useRef<OpenAxeBridge | null>(null)
  const inputTapRef = useRef<Float32Array>(new Float32Array(0))
  const outputTapRef = useRef<Float32Array>(new Float32Array(0))
  const pollIntervalRef = useRef<number | null>(null)

  // Serializes every open/start/stop/close sequence against every other one.
  // powerOn, the no-sound recovery poll, a stream-error recovery, and
  // powerOff/"Restart Audio Engine" are all independent async flows that
  // share the one native stream - without this, e.g. the recovery poll's
  // open()+start() can interleave with a concurrent powerOff()'s stop()+
  // close(), starting a stream that was just torn down underneath it and
  // crashing the real-time audio thread. Queuing every op onto this chain
  // makes them run one at a time, in call order, no matter which async flow
  // triggered them.
  const opQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const runExclusive = useCallback(<T>(fn: () => Promise<T>): Promise<T> => {
    const result = opQueueRef.current.then(fn, fn)
    opQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  /**
   * A second process (e.g. a browser tab also open on the same physical mic/
   * speakers) can force the OS to reconfigure a device mid-stream. The C++
   * core observes the error and stops touching the stream in its callback (see
   * audio.cpp), so by the time this fires there's nothing left to crash - just
   * a broken stream to tear down cleanly and drop into no-sound mode, where the
   * existing recovery poll below picks it back up automatically once a usable
   * device reappears.
   */
  const handleStreamError = useCallback(
    async (bridge: OpenAxeBridge, message: string) => {
      if (handlingStreamErrorRef.current) return
      handlingStreamErrorRef.current = true
      try {
        await runExclusive(async () => {
          await bridge.stop().catch(() => {})
          await bridge.close().catch(() => {})
        })
        toast.error('Audio device error', {
          description: `${message} — switched to no-sound mode; it'll reconnect automatically once a device is available.`,
        })
        setState((s) =>
          s.status === 'ready'
            ? {
                ...s,
                context: null,
                analyser: null,
                tunerAnalyser: null,
                micGranted: false,
                noSound: true,
              }
            : s,
        )
      } finally {
        handlingStreamErrorRef.current = false
      }
    },
    [runExclusive],
  )

  // Input TRIM. The web engine puts a GainNode between the input source and
  // the rig; the desktop shell has no Web Audio to hang one off, so the same
  // scalar is pushed to the C++ audio callback instead (issue #115), which
  // applies it before the graph and before the monitor taps - so the input
  // meter and tuner read post-trim on both paths. Runs on power-on too (the
  // status transition), so the knob's current value is never left behind.
  const inputGain = useIOStore((s) => s.inputGain)
  const inputChannel = useIOStore((s) => s.inputChannel)
  useEffect(() => {
    if (state.status !== 'ready') return
    const bridge = bridgeRef.current
    if (!bridge) return
    void bridge.setInputGain({ gain: inputGain }).catch(() => {})
  }, [inputGain, state.status])

  // Push input-channel changes down to the plugin. Only in a plugin: the
  // desktop shell opens the device itself, where channel selection belongs at
  // the device layer rather than in the graph feed, and it offers no such
  // control yet (see scripts/check-bridge-methods.mjs).
  useEffect(() => {
    if (state.status !== 'ready') return
    if (getShellKind() !== 'plugin') return
    const bridge = bridgeRef.current
    if (!bridge) return
    void bridge.setInputChannel({ mode: inputChannel }).catch(() => {})
  }, [inputChannel, state.status])

  // While the engine is running, keep the analysers fed from the latest native
  // taps and drive block meters from the core's real peaks. No-op in no-sound
  // mode - there's no running stream to poll.
  useEffect(() => {
    if (state.status !== 'ready' || state.noSound || !bridgeRef.current || !rigRef.current) return
    const bridge = bridgeRef.current
    const rig = rigRef.current

    const poll = () => {
      void bridge
        .takeStreamError()
        .then(({ error }) => {
          if (error) void handleStreamError(bridge, error)
        })
        .catch(() => {})
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
  }, [state.status, state.noSound, handleStreamError])

  /**
   * Opens + starts the native stream with independent input/output device
   * ids (the C++ core opens them as separate createDevice(output, input)
   * names - see apps/desktop/src/audio.cpp's Open()) and builds the
   * Web-Audio-free context/analyser shims. Shared by the explicit "Power On"
   * path and the no-sound recovery poll below, since both need the identical
   * sequence.
   */
  const openAndStart = useCallback(
    (bridge: OpenAxeBridge, inputDeviceId: number, outputDeviceId: number) =>
      runExclusive(async () => {
        const io = useIOStore.getState()
        // In a plugin the DAW already has the device open at its own sample
        // rate and buffer size; there is nothing for us to open or start, and
        // the device ids are meaningless. We still need the real rate for the
        // analyser/tuner shims, so read it from the host's config
        // (issue #300 E1/E2).
        const hostOwnsDevice = !shellOwnsAudioDevice()
        const opened = hostOwnsDevice
          ? await bridge.getConfig()
          : await bridge.open({
              inputDeviceId,
              outputDeviceId,
              sampleRate: SAMPLE_RATE,
              bufferFrames: LATENCY_BUFFER[io.latencyHint] ?? 128,
            })
        if (!opened.ok) {
          const reason = 'error' in opened ? opened.error : undefined
          throw new Error(reason ?? 'failed to open audio device')
        }
        if (!hostOwnsDevice) {
          const started = await bridge.start()
          if (!started.ok) throw new Error(started.error ?? 'failed to start audio')
        }

        // Adopt the plugin's own input routing rather than pushing the store's
        // at it. The choice describes how this instance's track is wired — it
        // rides the host's state chunk, and two instances in one project can
        // legitimately differ — so the plugin is the authority here, exactly
        // as it is for the rig itself.
        if ('inputChannel' in opened && opened.inputChannel) {
          useIOStore.setState({ inputChannel: opened.inputChannel })
        }

        // SAMPLE_RATE is only a last-resort fallback: the host's real rate
        // wins wherever the bridge reports one.
        const actualRate =
          typeof opened.sampleRate === 'number' && opened.sampleRate > 0
            ? opened.sampleRate
            : SAMPLE_RATE
        const context = new NativeAudioContext(actualRate)
        const analyser = new NativeAnalyser({
          fftSize: 256,
          sampleRate: actualRate,
          read: () => outputTapRef.current,
        })
        // Large fftSize: the tuner's autocorrelation needs a wide window to
        // resolve low bass (~31Hz needs >1500 samples per cycle at 48kHz).
        const tunerAnalyser = new NativeAnalyser({
          fftSize: 4096,
          sampleRate: actualRate,
          read: () => inputTapRef.current,
        })
        return { context, analyser, tunerAnalyser }
      }),
    [runExclusive],
  )

  const powerOn = useCallback(
    async (opts?: NativeAudioEnginePowerOnOptions) => {
      if (startingRef.current || state.status === 'ready') return
      const bridge = getOpenAxe()
      if (!bridge) {
        setState({ ...IDLE, status: 'error', error: 'Native audio bridge unavailable' })
        return
      }
      startingRef.current = true
      setState((s) => ({ ...s, status: 'starting', error: null }))

      try {
        const rig = new NativeGraphRig(bridge)
        rigRef.current = rig
        bridgeRef.current = bridge

        // In a plugin the C++ graph is the source of truth and already holds a
        // rig: the DAW restored its chunk before the editor opened, and closing
        // the editor destroys this hook while the graph keeps processing. Adopt
        // what is there and push it into the store, rather than letting
        // bindGraphRig reconcile the store's (browser-storage) idea of the rig
        // onto the core and duplicate or clobber it (issue #300 D1/D2).
        if (!shellOwnsAudioDevice()) {
          const adopted = await rig.adoptFromCore()
          if (adopted && adopted.blocks.length > 0) {
            useGraphStore
              .getState()
              .loadGraph(adopted.blocks, adopted.edges, adopted.masterLevel, adopted.masterMuted)
          }
        }

        unbindRef.current = bindGraphRig(useGraphStore, rig)

        if (opts?.noSound) {
          // Editing-only mode: build the rig, skip opening the stream. The
          // recovery effect below takes over from here.
          setState({
            status: 'ready',
            error: null,
            rig,
            context: null,
            analyser: null,
            tunerAnalyser: null,
            micGranted: false,
            noSound: true,
          })
          return
        }

        const io = useIOStore.getState()
        const { context, analyser, tunerAnalyser } = await openAndStart(
          bridge,
          resolveDeviceId(io.inputDeviceId),
          resolveDeviceId(io.outputDeviceId),
        )

        setState({
          status: 'ready',
          error: null,
          rig,
          context,
          analyser,
          tunerAnalyser,
          micGranted: true, // native input is always available (device, not permission)
          noSound: false,
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
    },
    [state.status, openAndStart],
  )

  // No-sound recovery: periodically try to open the stream with the user's
  // chosen (or default) input + output devices and switch to normal mode the
  // moment it opens - no user confirmation. Input and output are opened
  // independently (the native core accepts separate device names), so a
  // mismatched pair is fine here - we never overwrite the saved selections.
  useEffect(() => {
    if (state.status !== 'ready' || !state.noSound) return
    const bridge = bridgeRef.current
    const rig = rigRef.current
    if (!bridge || !rig) return

    const tryRecover = async () => {
      if (recoveringRef.current) return
      recoveringRef.current = true
      try {
        const io = useIOStore.getState()
        const { context, analyser, tunerAnalyser } = await openAndStart(
          bridge,
          resolveDeviceId(io.inputDeviceId),
          resolveDeviceId(io.outputDeviceId),
        )
        setState((s) =>
          s.rig === rig
            ? {
                ...s,
                context,
                analyser,
                tunerAnalyser,
                micGranted: true,
                noSound: false,
              }
            : s,
        )
      } catch {
        // Still no usable device (or it failed to open) - try again next tick.
      } finally {
        recoveringRef.current = false
      }
    }

    void tryRecover()
    const id = window.setInterval(() => void tryRecover(), DEVICE_RECOVERY_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [state.status, state.noSound, openAndStart])

  const powerOff = useCallback(async () => {
    unbindRef.current?.()
    unbindRef.current = null
    inputTapRef.current = new Float32Array(0)
    outputTapRef.current = new Float32Array(0)
    const bridge = bridgeRef.current
    bridgeRef.current = null
    if (bridge) {
      await runExclusive(async () => {
        await bridge.stop().catch(() => {})
        await bridge.close().catch(() => {})
      })
    }
    await rigRef.current?.dispose()
    rigRef.current = null
    setState(IDLE)
  }, [runExclusive])

  return { ...state, powerOn, powerOff }
}
