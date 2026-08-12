import { useCallback, useEffect, useRef, useState } from 'react'
import { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { DualChainRig } from '../engine/DualChainRig'
import { bindDualChainRig } from '../engine/bindDualChainRig'
import { useDualChainStore } from '../state/dualChainStore'
import { useIOStore } from '../state/ioStore'

export type EngineStatus = 'off' | 'starting' | 'ready' | 'error'

export interface AudioEngineState {
  status: EngineStatus
  error: string | null
  rig: DualChainRig | null
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
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const channelRouterRef = useRef<AudioNode[]>([])
  const trimRef = useRef<GainNode | null>(null)

  // Sync input gain to the trim node when it changes while the engine is running.
  const inputGain = useIOStore((s) => s.inputGain)
  useEffect(() => {
    if (trimRef.current) {
      trimRef.current.gain.setTargetAtTime(inputGain, state.context?.currentTime ?? 0, 0.01)
    }
  }, [inputGain, state.context])

  const powerOn = useCallback(async () => {
    if (startingRef.current || state.status === 'ready') return
    startingRef.current = true
    setState((s) => ({ ...s, status: 'starting', error: null }))

    try {
      const io = useIOStore.getState()
      const context = new AudioContext({ latencyHint: io.latencyHint })
      const engine = await NamEngine.attach(context)
      const rig = await DualChainRig.create(context, engine)

      // Wire the output device if supported and a specific one is selected.
      if (io.outputDeviceId && 'setSinkId' in AudioContext.prototype) {
        try {
          await (context as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(
            io.outputDeviceId,
          )
        } catch {
          // setSinkId can fail if the device disappears between enumerate and now — continue with default.
        }
      }

      unbindRef.current = bindDualChainRig(useDualChainStore, rig)

      const analyser = new AnalyserNode(context, { fftSize: 256, smoothingTimeConstant: 0.6 })
      rig.outputNode.connect(analyser)
      analyser.connect(context.destination)

      setState({ status: 'ready', error: null, rig, context, analyser, micGranted: false })

      // Get user media with the selected input device (background, non-blocking).
      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
      if (io.inputDeviceId) audioConstraints.deviceId = { exact: io.inputDeviceId }
      const constraints: MediaStreamConstraints = { audio: audioConstraints }
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          streamRef.current = stream
          const source = context.createMediaStreamSource(stream)
          sourceRef.current = source
          const routerNodes: AudioNode[] = []
          const mode = useIOStore.getState().inputChannel
          const actualChannels = source.channelCount
          const routerOut = buildChannelRouter(context, source, mode, actualChannels, routerNodes)
          channelRouterRef.current = routerNodes
          const trim = new GainNode(context, { gain: useIOStore.getState().inputGain })
          trimRef.current = trim
          routerOut.connect(trim)
          rig.connectInput(trim, 'mono-to-both')
          setState((s) => (s.context === context ? { ...s, micGranted: true } : s))
        })
        .catch((micError: unknown) => {
          const msg = micError instanceof Error ? micError.message : String(micError)
          useIOStore.getState().setMicError(msg)
          console.warn('[useAudioEngine] microphone unavailable:', msg)
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
    for (const node of channelRouterRef.current) node.disconnect()
    channelRouterRef.current = []
    trimRef.current?.disconnect()
    trimRef.current = null
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
    // Splitter output 0 = first channel. Chain through a gain to make mono.
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
  // Merge to mono through a gain node.
  const g = new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' })
  merger.connect(g)
  nodes.push(g)
  return g
}
