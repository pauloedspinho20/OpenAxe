import { useCallback, useEffect, useRef, useState } from 'react'
import { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { GraphRig } from '../engine/GraphRig'
import { bindGraphRig } from '../engine/bindGraphRig'
import { useGraphStore } from '../state/graphStore'
import { useIOStore } from '../state/ioStore'

export type EngineStatus = 'off' | 'starting' | 'ready' | 'error'

export interface AudioEngineState {
  status: EngineStatus
  error: string | null
  rig: GraphRig | null
  context: AudioContext | null
  analyser: AnalyserNode | null
  micGranted: boolean
}

export interface AudioEngineActions {
  powerOn: () => Promise<void>
  powerOff: () => Promise<void>
}

const IDLE_STATE: AudioEngineState = {
  status: 'off',
  error: null,
  rig: null,
  context: null,
  analyser: null,
  micGranted: false,
}

export function useAudioEngine() {
  const [state, setState] = useState<AudioEngineState>(IDLE_STATE)
  const startingRef = useRef(false)
  const unbindRef = useRef<(() => void) | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const rigRef = useRef<GraphRig | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const channelRouterRef = useRef<AudioNode[]>([])
  const trimRef = useRef<GainNode | null>(null)
  const connectingRef = useRef(false)

  // Sync input gain to the trim node when it changes while the engine is running.
  const inputGain = useIOStore((s) => s.inputGain)
  useEffect(() => {
    if (trimRef.current && contextRef.current) {
      trimRef.current.gain.setTargetAtTime(inputGain, contextRef.current.currentTime, 0.01)
    }
  }, [inputGain])

  // Reconnect mic when the input device or channel routing changes live.
  const inputDeviceId = useIOStore((s) => s.inputDeviceId)
  const inputChannel = useIOStore((s) => s.inputChannel)
  useEffect(() => {
    if (state.status !== 'ready' || connectingRef.current) return
    void connectMic()
  }, [inputDeviceId, inputChannel, state.status])

  // Re-route to the selected output device live, without recreating the context.
  const outputDeviceId = useIOStore((s) => s.outputDeviceId)
  useEffect(() => {
    const ctx = contextRef.current
    if (state.status !== 'ready' || !ctx || !('setSinkId' in AudioContext.prototype)) return
    void (ctx as AudioContext & { setSinkId(id: string): Promise<void> })
      .setSinkId(outputDeviceId)
      .catch(() => {
        // setSinkId can fail if the device disappeared — continue with current output.
      })
  }, [outputDeviceId, state.status])

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

      const micGranted = true
      setState((s) => (s.context === ctx ? { ...s, micGranted } : s))
    } catch (micError: unknown) {
      const msg = micError instanceof Error ? micError.message : String(micError)
      useIOStore.getState().setMicError(msg)
      setState((s) => (s.context === ctx ? { ...s, micGranted: false } : s))
      console.warn('[useAudioEngine] microphone unavailable:', msg)
    } finally {
      connectingRef.current = false
    }
  }, [])

  // ── Power on / off ──────────────────────────────────────────────────────

  const powerOn = useCallback(async () => {
    if (startingRef.current || state.status === 'ready') return
    startingRef.current = true
    setState((s) => ({ ...s, status: 'starting', error: null }))

    try {
      const io = useIOStore.getState()
      const context = new AudioContext({ latencyHint: io.latencyHint })
      const engine = await NamEngine.attach(context)
      const rig = await GraphRig.create(context, engine)
      contextRef.current = context
      rigRef.current = rig

      unbindRef.current = bindGraphRig(useGraphStore, rig)

      const analyser = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
      rig.outputNode.connect(analyser)
      analyser.connect(context.destination)

      setState({ status: 'ready', error: null, rig, context, analyser, micGranted: false })

      // Start mic connection — the useEffect on inputDeviceId/inputChannel triggers this.
      void connectMic()
    } catch (error) {
      setState({
        ...IDLE_STATE,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      startingRef.current = false
    }
  }, [state.status, connectMic])

  const powerOff = useCallback(async () => {
    unbindRef.current?.()
    unbindRef.current = null
    teardownMic()
    state.analyser?.disconnect()
    await state.rig?.dispose()
    await state.context?.close()
    contextRef.current = null
    rigRef.current = null
    setState(IDLE_STATE)
  }, [state.rig, state.context, state.analyser])

  return { ...state, powerOn, powerOff }
}

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
