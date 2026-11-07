import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@openaxe/ui'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'
import {
  classifyInputRisk,
  isMicRiskAcknowledged,
  micRiskBlockedMessage,
  resolveSelectedInputLabel,
} from '../audio/detectRiskyInput'
import type { EngineStatus } from '../hooks/useAudioEngine'
import { NativeGraphRig } from '../native/NativeGraphRig'
import { NativeAnalyser } from '../native/NativeAnalyser'
import { NativeAudioContext } from '../native/NativeAudioContext'
import { getOpenAxe, shellOwnsAudioDevice, type OpenAxeBridge } from '../native/openaxe'
import { getDISample } from '../diSamples'

export interface NativeAudioEngineState {
  status: EngineStatus
  error: string | null
  rig: NativeGraphRig | null
  context: NativeAudioContext | null
  analyser: NativeAnalyser | null
  /** Right-channel tap of the rig output for the stereo rail meter (issue #385). */
  analyserR: NativeAnalyser | null
  tunerAnalyser: NativeAnalyser | null
  /** Right-channel tap of the trimmed input for the stereo rail meter (issue #385). */
  tunerAnalyserR: NativeAnalyser | null
  micGranted: boolean
  /** True once the user chose "Continue without sound" - no stream is open, the
   * rig exists for editing only. Cleared automatically the moment a duplex
   * device is found and the stream opens for real - see the recovery effect. */
  noSound: boolean
  diPlaying: boolean
  diSampleId: string | null
  diError: string | null
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
  analyserR: null,
  tunerAnalyser: null,
  tunerAnalyserR: null,
  micGranted: false,
  noSound: false,
  diPlaying: false,
  diSampleId: null,
  diError: null,
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
 * Feedback guard (issue #422) for shells that open a real device: never open
 * a likely built-in mic without explicit acknowledgement. Returns the block
 * message when the current selection must not go live, or null when it may.
 * Plugin shells are exempt — the DAW owns the input bus, there is no mic to
 * open and no picker that could have chosen one.
 */
function blockedMicMessage(): string | null {
  if (!shellOwnsAudioDevice()) return null
  const io = useIOStore.getState()
  const risk = classifyInputRisk(io.inputDeviceId, io.inputDevices, io.outputDevices)
  if (risk === 'safe') return null
  const acked = isMicRiskAcknowledged(
    io.inputDeviceId,
    resolveSelectedInputLabel(io.inputDeviceId, io.inputDevices),
    io.micRiskAckDeviceId,
    io.micRiskAckLabel,
  )
  return acked ? null : micRiskBlockedMessage(risk)
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
  const inputTapRRef = useRef<Float32Array>(new Float32Array(0))
  const outputTapRRef = useRef<Float32Array>(new Float32Array(0))
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
                analyserR: null,
                tunerAnalyser: null,
                tunerAnalyserR: null,
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
  const inputDeviceId = useIOStore((s) => s.inputDeviceId)
  const inputChannel = useIOStore((s) => s.inputChannel)
  useEffect(() => {
    if (state.status !== 'ready') return
    const bridge = bridgeRef.current
    if (!bridge) return
    void bridge.setInputGain({ gain: inputGain }).catch(() => {})
  }, [inputGain, state.status])

  // ── DI audition (loops through the graph, muting live mic) ───────────────
  const diPlayingRef = useRef(false)

  const stopDI = useCallback(() => {
    const bridge = bridgeRef.current
    if (bridge) void bridge.stopDI().catch(() => {})
    diPlayingRef.current = false
    setState((s) => (s.diPlaying ? { ...s, diPlaying: false } : s))
  }, [])

  const playDI = useCallback(
    async (sampleId: string) => {
      const sample = getDISample(sampleId)
      if (!sample) {
        setState((s) => ({ ...s, diError: `Unknown DI sample: ${sampleId}` }))
        return
      }
      const bridge = bridgeRef.current
      if (!bridge || state.status !== 'ready') {
        setState((s) => ({ ...s, diError: 'Audio engine not ready' }))
        return
      }
      if (diPlayingRef.current) {
        // Stop previous without awaiting — bridge is synchronous enough.
        try {
          await bridge.stopDI()
        } catch {}
      }
      try {
        const response = await fetch(encodeURI(sample.url))
        if (!response.ok) throw new Error(`Failed to fetch ${sample.url}: ${response.status}`)
        const arrayBuffer = await response.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        const base64 = btoa(binary)
        const loaded = await bridge.loadDIWav({ wavBase64: base64 })
        if (!loaded.ok) throw new Error(loaded.error ?? 'loadDIWav failed')
        const played = await bridge.playDI({ loop: true })
        if (!played.ok) throw new Error(played.error ?? 'playDI failed')
        diPlayingRef.current = true
        setState((s) => ({ ...s, diPlaying: true, diSampleId: sampleId, diError: null }))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, diError: msg }))
        console.warn('[useNativeAudioEngine] DI playback failed:', msg)
      }
    },
    [state.status],
  )

  // Auto-stop DI when live input changes (all-triggers).
  useEffect(() => {
    if (diPlayingRef.current) stopDI()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputDeviceId, inputChannel])

  // Push input-channel changes down to the native shell. Both shells honor
  // the same ioStore strings: the plugin routes per instance in the graph
  // feed, the desktop routes in the C++ audio callback (the device layer it
  // owns). Unknown modes degrade to stereo passthrough on the receiving end.
  useEffect(() => {
    if (state.status !== 'ready') return
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
          inputTapRRef.current = new Float32Array(t.r ?? [])
        })
        .catch(() => {})
      void bridge
        .getTap({ side: 'out', frames: TAP_FRAMES })
        .then((t) => {
          outputTapRef.current = new Float32Array(t.l)
          outputTapRRef.current = new Float32Array(t.r ?? [])
        })
        .catch(() => {})
      void bridge
        .meters()
        .then((meters) => {
          for (const m of meters) {
            rig.updateMeter(m.id, m.value)
            if (typeof m.input === 'number') rig.updateInputMeter(m.id, m.input)
          }
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
        // Right-channel taps for the stereo rail meters (issue #385) - the
        // C++ monitor taps already carry both channels (bridge getTap
        // returns `l` and `r`); the web path was only ever reading `l`.
        const analyserR = new NativeAnalyser({
          fftSize: 256,
          sampleRate: actualRate,
          read: () => outputTapRRef.current,
        })
        // Large fftSize: the tuner's autocorrelation needs a wide window to
        // resolve low bass (~31Hz needs >1500 samples per cycle at 48kHz).
        const tunerAnalyser = new NativeAnalyser({
          fftSize: 4096,
          sampleRate: actualRate,
          read: () => inputTapRef.current,
        })
        const tunerAnalyserR = new NativeAnalyser({
          fftSize: 4096,
          sampleRate: actualRate,
          read: () => inputTapRRef.current,
        })
        return { context, analyser, analyserR, tunerAnalyser, tunerAnalyserR }
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

        // Blocked (issue #422) lands in the same editing-only mode as an
        // explicit no-sound power-on: the rig is usable and DI audition works,
        // but no mic stream opens — with guidance instead of silence.
        const blockedMessage = blockedMicMessage()
        if (opts?.noSound || blockedMessage) {
          // Editing-only mode: build the rig, skip opening the stream. The
          // recovery effect below takes over from here.
          if (blockedMessage) useIOStore.getState().setMicError(blockedMessage)
          setState({
            status: 'ready',
            error: null,
            rig,
            context: null,
            analyser: null,
            analyserR: null,
            tunerAnalyser: null,
            tunerAnalyserR: null,
            micGranted: false,
            noSound: true,
            diPlaying: false,
            diSampleId: null,
            diError: null,
          })
          return
        }

        const io = useIOStore.getState()
        const { context, analyser, analyserR, tunerAnalyser, tunerAnalyserR } = await openAndStart(
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
          analyserR,
          tunerAnalyser,
          tunerAnalyserR,
          micGranted: true, // native input is always available (device, not permission)
          noSound: false,
          diPlaying: false,
          diSampleId: null,
          diError: null,
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
        // Stay in no-sound mode while the selection is risky-unacknowledged
        // (issue #422) — opening the stream here would undo the guard the
        // moment a device appears. Refresh the guidance in case enumeration
        // just resolved the labels.
        const blockedMessage = blockedMicMessage()
        if (blockedMessage) {
          const io = useIOStore.getState()
          if (io.micError !== blockedMessage) io.setMicError(blockedMessage)
          return
        }
        const io = useIOStore.getState()
        const { context, analyser, analyserR, tunerAnalyser, tunerAnalyserR } = await openAndStart(
          bridge,
          resolveDeviceId(io.inputDeviceId),
          resolveDeviceId(io.outputDeviceId),
        )
        // A stale guard message must not outlive the stream it blocked.
        useIOStore.getState().setMicError(null)
        setState((s) =>
          s.rig === rig
            ? {
                ...s,
                context,
                analyser,
                analyserR,
                tunerAnalyser,
                tunerAnalyserR,
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
    // Stop DI first so the audio thread isn't still reading its buffer.
    try {
      await bridgeRef.current?.stopDI().catch(() => {})
    } catch {}
    diPlayingRef.current = false
    unbindRef.current?.()
    unbindRef.current = null
    inputTapRef.current = new Float32Array(0)
    outputTapRef.current = new Float32Array(0)
    inputTapRRef.current = new Float32Array(0)
    outputTapRRef.current = new Float32Array(0)
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

  // The shared UI (App/GridEditor) reads the stereo rail meters as
  // analyserL/analyserR (issue #385) - the same names the web engine provides.
  // This hook's historic singular fields (analyser/tunerAnalyser) predate the
  // stereo meters and stay for their existing consumers (e.g. Tuner); without
  // these aliases analyserL/tunerAnalyserL are undefined on desktop, and
  // LiveStereoMeter renders a missing side as silence - a centered signal
  // then shows only its right bar.
  return {
    ...state,
    analyserL: state.analyser,
    tunerAnalyserL: state.tunerAnalyser,
    powerOn,
    powerOff,
    playDI,
    stopDI,
  }
}
