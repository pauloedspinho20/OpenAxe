import type { NamEngine } from 'neural-amp-modeler-wasm/engine'
import { AmpCabChain } from './AmpCabChain'
import { EffectsChain } from '../effects/EffectsChain'

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

function createChannelStrip(context: BaseAudioContext, pan: number): ChannelStrip {
  const levelGain = new GainNode(context)
  const panner = new StereoPannerNode(context, { pan })
  const muteGain = new GainNode(context)
  levelGain.connect(panner)
  panner.connect(muteGain)
  return { levelGain, panner, muteGain }
}

interface Side {
  readonly preFx: EffectsChain
  readonly amp: AmpCabChain
  readonly postFx: EffectsChain
  readonly strip: ChannelStrip
}

function createSide(context: BaseAudioContext, amp: AmpCabChain, pan: number): Side {
  const preFx = new EffectsChain(context)
  const postFx = new EffectsChain(context)
  const strip = createChannelStrip(context, pan)

  preFx.outputNode.connect(amp.inputNode)
  amp.outputNode.connect(postFx.inputNode)
  postFx.outputNode.connect(strip.levelGain)

  return { preFx, amp, postFx, strip }
}

/**
 * Two independent mono signal chains (see AmpCabChain for the amp+cab
 * block), each bracketed by its own pre/post EffectsChain per the
 * architecture diagram - `[FX] -> [NAM amp model] -> [IR cab] -> [FX]` -
 * then a level/pan/mute channel strip, summed to a stereo master bus. This
 * is the dual-chain rig: one instrument in, two differently-modeled amp
 * voicings out, panned across the stereo field.
 */
export class DualChainRig {
  private readonly context: BaseAudioContext
  private readonly sideA: Side
  private readonly sideB: Side
  private readonly master: GainNode
  private inputSplitter: ChannelSplitterNode | null = null
  private disposed = false

  private constructor(context: BaseAudioContext, ampA: AmpCabChain, ampB: AmpCabChain) {
    this.context = context
    this.sideA = createSide(context, ampA, -1)
    this.sideB = createSide(context, ampB, 1)
    this.master = new GainNode(context)
    this.sideA.strip.muteGain.connect(this.master)
    this.sideB.strip.muteGain.connect(this.master)
  }

  /** Create a rig on a shared NamEngine - both chains reuse its one wasm module. */
  static async create(context: BaseAudioContext, engine: NamEngine): Promise<DualChainRig> {
    const [ampA, ampB] = await Promise.all([
      AmpCabChain.create(context, engine),
      AmpCabChain.create(context, engine),
    ])
    return new DualChainRig(context, ampA, ampB)
  }

  private side(chain: ChainId): Side {
    return chain === 'A' ? this.sideA : this.sideB
  }

  /** The amp+cab chain for direct model/IR loading (AmpCabChain.loadModel/loadIR). */
  amp(chain: ChainId): AmpCabChain {
    return this.side(chain).amp
  }

  /** Effects placed before the amp model (e.g. gate, drive, EQ). */
  preFx(chain: ChainId): EffectsChain {
    return this.side(chain).preFx
  }

  /** Effects placed after the amp+cab (e.g. modulation, delay, reverb). */
  postFx(chain: ChainId): EffectsChain {
    return this.side(chain).postFx
  }

  /**
   * Connect a source into the rig (at the front of each side's preFx chain).
   * In 'mono-to-both' mode the same source feeds both chains (Web Audio fans
   * a node out to multiple destinations for free). In 'stereo-split' mode
   * the source's left/right channels are split, one to each chain -
   * disconnect() the previous routing yourself if you call this more than
   * once with a different mode.
   */
  connectInput(source: AudioNode, mode: InputRoutingMode): void {
    if (mode === 'mono-to-both') {
      source.connect(this.sideA.preFx.inputNode)
      source.connect(this.sideB.preFx.inputNode)
      return
    }
    const splitter = new ChannelSplitterNode(this.context, { numberOfOutputs: 2 })
    source.connect(splitter)
    splitter.connect(this.sideA.preFx.inputNode, 0)
    splitter.connect(this.sideB.preFx.inputNode, 1)
    this.inputSplitter = splitter
  }

  /** Disconnect a previously-connected source (whichever routing mode was used). */
  disconnectInput(source: AudioNode): void {
    source.disconnect()
    this.inputSplitter?.disconnect()
    this.inputSplitter = null
  }

  setLevel(chain: ChainId, level: number): void {
    this.side(chain).strip.levelGain.gain.setTargetAtTime(level, this.context.currentTime, 0.01)
  }

  setPan(chain: ChainId, pan: number): void {
    this.side(chain).strip.panner.pan.setTargetAtTime(pan, this.context.currentTime, 0.01)
  }

  /** Effective mute, i.e. already accounting for solo on the other chain - see dualChainStore.isEffectivelyMuted. */
  setEffectivelyMuted(chain: ChainId, muted: boolean): void {
    this.side(chain).strip.muteGain.gain.setTargetAtTime(
      muted ? 0 : 1,
      this.context.currentTime,
      0.01,
    )
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
    const effectDisposals: Array<void | Promise<void>> = []
    for (const side of [this.sideA, this.sideB]) {
      // EffectsChain.dispose() only tears down the chain's own wiring, not
      // the effects it holds (they might be reused elsewhere) - dispose
      // those explicitly.
      for (const effect of [...side.preFx.list(), ...side.postFx.list()]) {
        effectDisposals.push(effect.dispose())
      }
      side.preFx.dispose()
      side.postFx.dispose()
      side.strip.levelGain.disconnect()
      side.strip.panner.disconnect()
      side.strip.muteGain.disconnect()
    }
    this.master.disconnect()
    await Promise.all([this.sideA.amp.dispose(), this.sideB.amp.dispose(), ...effectDisposals])
  }
}
