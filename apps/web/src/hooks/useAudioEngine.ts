import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@openaxe/ui'
import { GraphRig } from '../engine/GraphRig'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'
import { getOpenAxe } from '../native/openaxe'
import { useNativeAudioEngine } from './useNativeAudioEngine'
import { getDISample } from '../diSamples'

export type EngineStatus = 'off' | 'starting' | 'ready' | 'error'

export interface AudioEnginePowerOnOptions {
  /** Skip the initial mic connection attempt (no permission prompt). The
   * device-list watcher below retries automatically once a real input
   * device appears - no user confirmation needed. */
  noSound?: boolean
}

export interface AudioEngineState {
  status: EngineStatus
  error: string | null
  rig: GraphRig | null
  context: AudioContext | null
  analyser: AnalyserNode | null
  /** Per-channel taps of the rig output for the stereo rail meter (issue #385). */
  analyserL: AnalyserNode | null
  analyserR: AnalyserNode | null
  /** Taps the raw input (post-trim, pre-graph) for the tuner - never touches the signal path itself. */
  tunerAnalyser: AnalyserNode | null
  /** Per-channel taps of the trimmed input for the stereo rail meter (issue #385). */
  tunerAnalyserL: AnalyserNode | null
  tunerAnalyserR: AnalyserNode | null
  micGranted: boolean
  /** True once the user chose "Continue without sound" - cleared the moment
   * a mic connects successfully, whether that's this initial no-sound skip
   * recovering on its own or a later manual device change. */
  noSound: boolean
  /** DI audition: true while a DI sample is looping through the rig. */
  diPlaying: boolean
  /** Which DI sample is currently playing (or last selected while stopped). */
  diSampleId: string | null
  diError: string | null
}

export interface AudioEngineActions {
  powerOn: (opts?: AudioEnginePowerOnOptions) => Promise<void>
  powerOff: () => Promise<void>
  /** Start looping the given DI sample through the rig (muting live mic). */
  playDI: (sampleId: string) => Promise<void>
  /** Stop DI playback and restore live mic. */
  stopDI: () => void
}

const IDLE_STATE: AudioEngineState = {
  status: 'off',
  error: null,
  rig: null,
  context: null,
  analyser: null,
  analyserL: null,
  analyserR: null,
  tunerAnalyser: null,
  tunerAnalyserL: null,
  tunerAnalyserR: null,
  micGranted: false,
  noSound: false,
  diPlaying: false,
  diSampleId: null,
  diError: null,
}

/**
 * Turns a powerOn failure (AudioContext creation, WASM fetch/instantiation,
 * GraphRig setup) into a message worth showing a guitarist, not a raw
 * `TypeError: Failed to fetch`. Falls back to the original message for
 * anything unrecognized so real detail is never hidden.
 */
export function describePowerOnError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (error instanceof TypeError && /fetch/i.test(raw)) {
    return "Couldn't load the audio engine — check your connection and press Power On again."
  }
  if (/NotAllowedError|permission/i.test(raw)) {
    return 'Audio was blocked by the browser — check your site permissions and try again.'
  }
  return raw
}

export function useWebAudioEngine() {
  const [state, setState] = useState<AudioEngineState>(IDLE_STATE)
  const startingRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rigRef = useRef<GraphRig | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const channelRouterRef = useRef<AudioNode[]>([])
  const trimRef = useRef<GainNode | null>(null)
  const tunerAnalyserRef = useRef<AnalyserNode | null>(null)
  // Stereo meter taps (issue #385): fixed splitters fanning the trimmed input
  // and the rig output out to per-channel analysers. Created once on power-on;
  // each (re)connect fans the fresh trim/gain node into the tuner splitter.
  const tunerSplitterRef = useRef<ChannelSplitterNode | null>(null)
  const outputSplitterRef = useRef<ChannelSplitterNode | null>(null)
  const connectingRef = useRef(false)
  // ── DI audition ───────────────────────────────────────────────────────
  const diSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const diGainRef = useRef<GainNode | null>(null)
  const diBufferCache = useRef<Map<string, AudioBuffer>>(new Map())
  const diPlayingRef = useRef(false)

  // Sync input gain to the trim node when it changes while the engine is running.
  const inputGain = useIOStore((s) => s.inputGain)
  useEffect(() => {
    if (trimRef.current && contextRef.current) {
      trimRef.current.gain.setTargetAtTime(inputGain, contextRef.current.currentTime, 0.01)
    }
    if (diGainRef.current && contextRef.current) {
      diGainRef.current.gain.setTargetAtTime(inputGain, contextRef.current.currentTime, 0.01)
    }
  }, [inputGain])

  const inputDeviceId = useIOStore((s) => s.inputDeviceId)
  const inputChannel = useIOStore((s) => s.inputChannel)

  // Re-route to the selected output device live, without recreating the context.
  const outputDeviceId = useIOStore((s) => s.outputDeviceId)
  useEffect(() => {
    const ctx = contextRef.current
    if (state.status !== 'ready' || !ctx || !('setSinkId' in AudioContext.prototype)) return
    void (ctx as AudioContext & { setSinkId(id: string): Promise<void> })
      .setSinkId(outputDeviceId)
      .catch((err: unknown) => {
        // setSinkId fails if the device disappeared — keep playing on whatever
        // output the context already has, but say so instead of going silent.
        console.warn('[useAudioEngine] output device unavailable:', err)
        toast.warning('Output device unavailable', {
          description: 'Switched output disconnected — staying on the previous device.',
        })
      })
  }, [outputDeviceId, state.status])

  // Recover a suspended AudioContext: browsers/OSes can interrupt playback
  // (a phone call, another app taking exclusive audio, a screen lock) without
  // this app ever calling suspend() itself. Retry on the state's own
  // statechange event and again whenever the tab regains visibility/focus,
  // since resume() sometimes needs a fresh user-gesture-adjacent moment to
  // succeed on strict autoplay policies.
  useEffect(() => {
    if (state.status !== 'ready' || !state.context) return
    const ctx = state.context
    const tryResume = () => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    }
    tryResume()
    ctx.addEventListener('statechange', tryResume)
    document.addEventListener('visibilitychange', tryResume)
    window.addEventListener('focus', tryResume)
    return () => {
      ctx.removeEventListener('statechange', tryResume)
      document.removeEventListener('visibilitychange', tryResume)
      window.removeEventListener('focus', tryResume)
    }
  }, [state.status, state.context])

  // ── Mic connection ──────────────────────────────────────────────────────

  function teardownMic() {
    useIOStore.getState().setMicError(null)
    for (const node of channelRouterRef.current) node.disconnect()
    channelRouterRef.current = []
    trimRef.current?.disconnect()
    trimRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const connectMic = useCallback(async () => {
    const ctx = contextRef.current
    const rig = rigRef.current
    if (!ctx || !rig) return
    if (connectingRef.current) return
    connectingRef.current = true

    teardownMic()

    try {
      const io = useIOStore.getState()
      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
      if (io.inputDeviceId) audioConstraints.deviceId = { exact: io.inputDeviceId }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

      streamRef.current = stream
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source

      const routerNodes: AudioNode[] = []
      const actualChannels = source.channelCount
      const routerOut = buildChannelRouter(
        ctx,
        source,
        io.inputChannel,
        actualChannels,
        routerNodes,
      )
      channelRouterRef.current = routerNodes

      const trim = new GainNode(ctx, { gain: io.inputGain })
      trimRef.current = trim
      routerOut.connect(trim)
      rig.connectInput(trim)
      // Tap the same trimmed signal for the tuner - a second fan-out from
      // `trim`, entirely separate from the graph it feeds into, so tuning
      // never touches (or is touched by) whatever's on the grid.
      if (tunerAnalyserRef.current) trim.connect(tunerAnalyserRef.current)
      // Per-channel fan-out for the stereo input meter (issue #385).
      if (tunerSplitterRef.current) trim.connect(tunerSplitterRef.current)

      const micGranted = true
      // A successful connection always means we're no longer in a deliberate
      // no-sound state, whether this was the explicit initial attempt, a
      // manual device change, or the auto-recovery watcher below finding a
      // device on its own.
      setState((s) => (s.context === ctx ? { ...s, micGranted, noSound: false } : s))
    } catch (micError: unknown) {
      const msg = micError instanceof Error ? micError.message : String(micError)
      useIOStore.getState().setMicError(msg)
      setState((s) => (s.context === ctx ? { ...s, micGranted: false } : s))
      console.warn('[useAudioEngine] microphone unavailable:', msg)
    } finally {
      connectingRef.current = false
    }
  }, [])

  // ── DI audition (loops through the rig, muting live mic) ───────────────

  const stopDI = useCallback(() => {
    const ctx = contextRef.current
    const rig = rigRef.current
    const source = diSourceRef.current
    const gain = diGainRef.current
    if (!source && !gain) {
      if (diPlayingRef.current) {
        diPlayingRef.current = false
        setState((s) => (s.diPlaying ? { ...s, diPlaying: false } : s))
      }
      return
    }
    try {
      source?.stop()
    } catch {
      // already stopped
    }
    try {
      source?.disconnect()
    } catch {}
    try {
      gain?.disconnect()
    } catch {}
    diSourceRef.current = null
    diGainRef.current = null
    diPlayingRef.current = false

    // Restore live mic path if one existed before DI took over.
    if (ctx && rig && trimRef.current) {
      try {
        rig.connectInput(trimRef.current)
      } catch {}
      if (tunerAnalyserRef.current) {
        try {
          trimRef.current.connect(tunerAnalyserRef.current)
        } catch {}
      }
      if (tunerSplitterRef.current) {
        try {
          trimRef.current.connect(tunerSplitterRef.current)
        } catch {}
      }
    }
    setState((s) => (s.diPlaying ? { ...s, diPlaying: false } : s))
  }, [])

  const playDI = useCallback(
    async (sampleId: string) => {
      const sample = getDISample(sampleId)
      if (!sample) {
        setState((s) => ({ ...s, diError: `Unknown DI sample: ${sampleId}` }))
        return
      }
      const ctx = contextRef.current
      const rig = rigRef.current
      if (!ctx || !rig || state.status !== 'ready') {
        setState((s) => ({ ...s, diError: 'Audio engine not ready' }))
        return
      }

      // Stop any current DI first (ensures no double-voice).
      if (diPlayingRef.current) stopDI()

      try {
        let buffer = diBufferCache.current.get(sampleId)
        if (!buffer) {
          const response = await fetch(encodeURI(sample.url))
          if (!response.ok) throw new Error(`Failed to fetch ${sample.url}: ${response.status}`)
          const arrayBuffer = await response.arrayBuffer()
          // decodeAudioData returns Promise in modern browsers; callback form is legacy.
          buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
          diBufferCache.current.set(sampleId, buffer)
        }

        if (ctx.state === 'suspended') await ctx.resume().catch(() => {})

        // Mute live mic: disconnect trim from rig/tuner (router->trim stays, so restore is trivial).
        if (trimRef.current) {
          try {
            rig.disconnectInput()
          } catch {}
          try {
            trimRef.current.disconnect()
          } catch {}
        }

        const gain = new GainNode(ctx, { gain: useIOStore.getState().inputGain })
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true
        source.connect(gain)
        // Route DI through the rig (GraphRig tracks the single input source).
        // Disconnect any previous mic input first so DI is exclusive.
        try {
          rig.disconnectInput()
        } catch {}
        rig.connectInput(gain)
        if (tunerAnalyserRef.current) gain.connect(tunerAnalyserRef.current)
        if (tunerSplitterRef.current) gain.connect(tunerSplitterRef.current)

        diSourceRef.current = source
        diGainRef.current = gain
        diPlayingRef.current = true
        setState((s) => ({ ...s, diPlaying: true, diSampleId: sampleId, diError: null }))

        source.start()
        source.onended = () => {
          // onended fires on stop() too; only clear if still the active source.
          if (diSourceRef.current === source) stopDI()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, diError: msg }))
        // Ensure mic is restored on failure.
        if (trimRef.current && rig) {
          try {
            rig.connectInput(trimRef.current)
          } catch {}
          if (tunerAnalyserRef.current) {
            try {
              trimRef.current.connect(tunerAnalyserRef.current)
            } catch {}
          }
          if (tunerSplitterRef.current) {
            try {
              trimRef.current.connect(tunerSplitterRef.current)
            } catch {}
          }
        }
        console.warn('[useAudioEngine] DI playback failed:', msg)
      }
    },
    [state.status, stopDI],
  )

  // Auto-stop DI when the live input device/channel changes (all-triggers rule).
  useEffect(() => {
    if (diPlayingRef.current) stopDI()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputDeviceId, inputChannel])

  // Keep diSampleId in state even when stopped so the UI remembers selection.
  // Initialise from the persisted DI store's selection if engine has none yet.
  useEffect(() => {
    if (state.diSampleId) return
    try {
      const raw = localStorage.getItem('openaxe-di-audition')
      if (!raw) return
      const parsed = JSON.parse(raw) as { state?: { selectedId?: string } }
      const id = parsed?.state?.selectedId ?? null
      if (id && getDISample(id)) setState((s) => ({ ...s, diSampleId: id }))
      else if (!id) {
        // Fallback to default guitar-clean if nothing persisted.
        setState((s) => ({ ...s, diSampleId: 'guitar-clean' }))
      }
    } catch {}
  }, [state.diSampleId])

  // Reconnect mic when the input device or channel routing changes live.
  // Skipped once right after a no-sound power-on (see powerOn below) so
  // choosing "Continue without sound" doesn't immediately trigger the very
  // permission prompt it was meant to skip; any later device/channel change -
  // manual or auto-detected - clears the skip and reconnects normally.
  const skipNextAutoConnectRef = useRef(false)
  useEffect(() => {
    if (state.status !== 'ready' || connectingRef.current) return
    if (skipNextAutoConnectRef.current) {
      skipNextAutoConnectRef.current = false
      return
    }
    void connectMic()
  }, [inputDeviceId, inputChannel, state.status, connectMic])

  // No-sound recovery: while deliberately running without a mic, re-attempt
  // connectMic() whenever the enumerated input device list changes (a device
  // was plugged in). Switches back to normal mode automatically on success -
  // no user confirmation - and silently stays in no-sound mode if permission
  // is denied, without spamming the browser's permission prompt on every
  // unrelated devicechange.
  const inputDevices = useIOStore((s) => s.inputDevices)
  const inputDevicesSignature = inputDevices.map((d) => d.deviceId).join(',')
  const lastRecoveryAttemptRef = useRef<string | null>(null)
  useEffect(() => {
    if (state.status !== 'ready' || !state.noSound) {
      lastRecoveryAttemptRef.current = null
      return
    }
    if (inputDevicesSignature === '' || lastRecoveryAttemptRef.current === inputDevicesSignature)
      return
    lastRecoveryAttemptRef.current = inputDevicesSignature
    void connectMic()
  }, [inputDevicesSignature, state.status, state.noSound, connectMic])

  // ── Power on / off ──────────────────────────────────────────────────────

  const powerOn = useCallback(
    async (opts?: AudioEnginePowerOnOptions) => {
      if (startingRef.current || state.status === 'ready') return
      startingRef.current = true
      setState((s) => ({ ...s, status: 'starting', error: null }))

      try {
        const io = useIOStore.getState()
        const context = new AudioContext({ latencyHint: io.latencyHint })
        // No NAM engine to attach any more: amp blocks run packages/core's own
        // inference in their own worklet (see NamAmpNode), same as every effect.
        const rig = await GraphRig.create(context)
        contextRef.current = context
        rigRef.current = rig

        unbindRef.current = bindGraphRig(useGraphStore, rig)

        const analyser = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
        rig.outputNode.connect(analyser)
        analyser.connect(context.destination)

        // Per-channel output taps for the stereo rail meter (issue #385): a
        // parallel fan-out beside the mono analyser above, so each side reads
        // its real channel instead of a mono mix.
        const outputSplitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 })
        rig.outputNode.connect(outputSplitter)
        const analyserL = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
        const analyserR = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
        outputSplitter.connect(analyserL, 0)
        outputSplitter.connect(analyserR, 1)
        outputSplitterRef.current = outputSplitter

        // Large fftSize: the tuner's autocorrelation needs a wide enough
        // time-domain window to resolve low frequencies (a 5-string bass's
        // low B is ~31Hz, needing >1500 samples per cycle at 48kHz).
        const tunerAnalyser = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0 })
        tunerAnalyserRef.current = tunerAnalyser

        // Per-channel input taps for the stereo rail meter (issue #385): the
        // trim/gain node fans into this splitter on every (re)connect, so the
        // pair reads post-trim L/R exactly like the mono tuner tap does.
        const tunerSplitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 })
        const tunerAnalyserL = new AnalyserNode(context, {
          fftSize: 256,
          smoothingTimeConstant: 0.6,
        })
        const tunerAnalyserR = new AnalyserNode(context, {
          fftSize: 256,
          smoothingTimeConstant: 0.6,
        })
        tunerSplitter.connect(tunerAnalyserL, 0)
        tunerSplitter.connect(tunerAnalyserR, 1)
        tunerSplitterRef.current = tunerSplitter

        const noSound = opts?.noSound ?? false
        setState((s) => ({
          ...s,
          status: 'ready',
          error: null,
          rig,
          context,
          analyser,
          analyserL,
          analyserR,
          tunerAnalyser,
          tunerAnalyserL,
          tunerAnalyserR,
          micGranted: false,
          noSound,
          diPlaying: false,
          diError: null,
        }))

        if (noSound) {
          skipNextAutoConnectRef.current = true
        } else {
          // Start mic connection — the useEffect on inputDeviceId/inputChannel triggers this.
          void connectMic()
        }
      } catch (error) {
        const message = describePowerOnError(error)
        toast.error('Audio engine failed to start', { description: message })
        setState({
          ...IDLE_STATE,
          status: 'error',
          error: message,
        })
      } finally {
        startingRef.current = false
      }
    },
    [state.status, connectMic],
  )

  const powerOff = useCallback(async () => {
    stopDI()
    unbindRef.current?.()
    unbindRef.current = null
    teardownMic()
    state.analyser?.disconnect()
    state.analyserL?.disconnect()
    state.analyserR?.disconnect()
    state.tunerAnalyser?.disconnect()
    state.tunerAnalyserL?.disconnect()
    state.tunerAnalyserR?.disconnect()
    tunerAnalyserRef.current = null
    tunerSplitterRef.current?.disconnect()
    tunerSplitterRef.current = null
    outputSplitterRef.current?.disconnect()
    outputSplitterRef.current = null
    await state.rig?.dispose()
    await state.context?.close()
    contextRef.current = null
    rigRef.current = null
    diBufferCache.current.clear()
    setState(IDLE_STATE)
  }, [
    state.rig,
    state.context,
    state.analyser,
    state.analyserL,
    state.analyserR,
    state.tunerAnalyser,
    state.tunerAnalyserL,
    state.tunerAnalyserR,
    stopDI,
  ])

  return { ...state, powerOn, powerOff, playDI, stopDI }
}

// Engine dispatcher (issue #15 M3, issue #44): in the desktop shell the audio
// runs in the C++ core via window.openAxe; in the browser it's Web Audio.
// window.openAxe is injected by the desktop shell's native init script
// before this module's own script ever runs (apps/desktop/src/main.cpp binds
// it, then navigates), so which shell this is runs exactly once, at module
// load, and never changes for the page's lifetime. Selecting the hook
// implementation itself here - rather than calling both hooks every render
// and picking which result to keep (the previous approach) - means only the
// active engine's effects/subscriptions ever mount: no double store
// subscriptions, no wasted mount-time effects on the inactive engine. Every
// call site still does a single, unconditional `useAudioEngine()` call, so
// the rules of hooks hold; the branch just lives outside any component.
const isNativeShell = getOpenAxe() !== null

/** The union is cast to the web shape so App.tsx and every component consume
 * the same AudioEngineState - NativeGraphRig satisfies the
 * GraphRigControls/PresetRig surface they actually use. */
export const useAudioEngine: () => AudioEngineState & AudioEngineActions = isNativeShell
  ? (useNativeAudioEngine as unknown as () => AudioEngineState & AudioEngineActions)
  : useWebAudioEngine

/**
 * Build a channel router that maps the source's input channels to the
 * desired mode. Returns the output node that should connect to the trim.
 * Collected nodes are pushed into `nodes` for later disconnect.
 */
function buildChannelRouter(
  context: BaseAudioContext,
  source: MediaStreamAudioSourceNode,
  mode: 'l' | 'r' | 'stereo' | 'sum',
  channelCount: number,
  nodes: AudioNode[],
): AudioNode {
  if (mode === 'stereo' && channelCount >= 2) return source

  const splitter = new ChannelSplitterNode(context, { numberOfOutputs: Math.max(channelCount, 2) })
  source.connect(splitter)
  nodes.push(splitter)

  if (mode === 'l') {
    const g = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' })
    splitter.connect(g, 0, 0)
    nodes.push(g)
    return g
  }

  if (mode === 'r' && channelCount >= 2) {
    const g = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' })
    splitter.connect(g, 1, 0)
    nodes.push(g)
    return g
  }

  // Sum both available channels to mono.
  const merger = new ChannelMergerNode(context, { numberOfInputs: 2 })
  splitter.connect(merger, 0, 0)
  if (channelCount >= 2) splitter.connect(merger, 1, 1)
  nodes.push(merger)
  const g = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' })
  merger.connect(g)
  nodes.push(g)
  return g
}
