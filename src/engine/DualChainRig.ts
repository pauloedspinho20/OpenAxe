import type { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { AmpCabChain } from './AmpCabChain'

export type ChainId = 'A' | 'B'

/** How a source feeds the two chains. */
export type InputRoutingMode =
  /** Duplicate a mono source to both chains (the common case: one instrument, two amp voicings). */
  | 'mono-to-both'
  /** Split a stereo source's L/R channels, one to each chain (e.g. a stereo pickup or two mic'd sources). */
  | 'stereo-split'

interface ChannelStrip {
  readonly levelGain: GainNode
  readonly panner: StereoPannerNode
  readonly muteGain: GainNode
}

function createChannelStrip(
  context: BaseAudioContext,
  chain: AmpCabChain,
  pan: number,
): ChannelStrip {
  const levelGain = new GainNode(context)
  const panner = new StereoPannerNode(context, { pan })
  const muteGain = new GainNode(context)
  chain.outputNode.connect(levelGain)
  levelGain.connect(panner)
  panner.connect(muteGain)
  return { levelGain, panner, muteGain }
}

/**
 * Two independent mono amp+cab chains (see AmpCabChain), each with its own
 * level/pan/mute channel strip, summed to a stereo master bus. This is the
 * dual-chain rig: one instrument in, two differently-modeled amp voicings
 * out, panned across the stereo field.
 */
export class DualChainRig {
  private readonly context: BaseAudioContext
  private readonly ampA: AmpCabChain
  private readonly ampB: AmpCabChain
  private readonly stripA: ChannelStrip
  private readonly stripB: ChannelStrip
  private readonly master: GainNode
  private inputSplitter: ChannelSplitterNode | null = null
  private disposed = false

  private constructor(context: BaseAudioContext, ampA: AmpCabChain, ampB: AmpCabChain) {
    this.context = context
    this.ampA = ampA
    this.ampB = ampB
    this.stripA = createChannelStrip(context, ampA, -1)
    this.stripB = createChannelStrip(context, ampB, 1)
    this.master = new GainNode(context)
    this.stripA.muteGain.connect(this.master)
    this.stripB.muteGain.connect(this.master)
  }

  /** Create a rig on a shared NamEngine - both chains reuse its one wasm module. */
  static async create(context: BaseAudioContext, engine: NamEngine): Promise<DualChainRig> {
    const [ampA, ampB] = await Promise.all([
      AmpCabChain.create(context, engine),
      AmpCabChain.create(context, engine),
    ])
    return new DualChainRig(context, ampA, ampB)
  }

  /** The amp+cab chain for direct model/IR loading (AmpCabChain.loadModel/loadIR). */
  amp(chain: ChainId): AmpCabChain {
    return chain === 'A' ? this.ampA : this.ampB
  }

  /**
   * Connect a source into the rig. In 'mono-to-both' mode the same source
   * feeds both chains (Web Audio fans a node out to multiple destinations
   * for free). In 'stereo-split' mode the source's left/right channels are
   * split, one to each chain - disconnect() the previous routing yourself if
   * you call this more than once with a different mode.
   */
  connectInput(source: AudioNode, mode: InputRoutingMode): void {
    if (mode === 'mono-to-both') {
      source.connect(this.ampA.inputNode)
      source.connect(this.ampB.inputNode)
      return
    }
    const splitter = new ChannelSplitterNode(this.context, { numberOfOutputs: 2 })
    source.connect(splitter)
    splitter.connect(this.ampA.inputNode, 0)
    splitter.connect(this.ampB.inputNode, 1)
    this.inputSplitter = splitter
  }

  /** Disconnect a previously-connected source (whichever routing mode was used). */
  disconnectInput(source: AudioNode): void {
    source.disconnect()
    this.inputSplitter?.disconnect()
    this.inputSplitter = null
  }

  setLevel(chain: ChainId, level: number): void {
    const strip = chain === 'A' ? this.stripA : this.stripB
    strip.levelGain.gain.setTargetAtTime(level, this.context.currentTime, 0.01)
  }

  setPan(chain: ChainId, pan: number): void {
    const strip = chain === 'A' ? this.stripA : this.stripB
    strip.panner.pan.setTargetAtTime(pan, this.context.currentTime, 0.01)
  }

  /** Effective mute, i.e. already accounting for solo on the other chain - see dualChainStore.isEffectivelyMuted. */
  setEffectivelyMuted(chain: ChainId, muted: boolean): void {
    const strip = chain === 'A' ? this.stripA : this.stripB
    strip.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.01)
  }

  setMasterLevel(level: number): void {
    this.master.gain.setTargetAtTime(level, this.context.currentTime, 0.01)
  }

  /** The rig's stereo output - connect to your output device chain / AudioContext.destination. */
  get outputNode(): AudioNode {
    return this.master
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.inputSplitter?.disconnect()
    for (const strip of [this.stripA, this.stripB]) {
      strip.levelGain.disconnect()
      strip.panner.disconnect()
      strip.muteGain.disconnect()
    }
    this.master.disconnect()
    await Promise.all([this.ampA.dispose(), this.ampB.dispose()])
  }
}
