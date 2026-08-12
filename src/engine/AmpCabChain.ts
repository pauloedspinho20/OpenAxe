import { NamEngine, NamNode, type NamModelInfo } from 'neural-amp-modeler-wasm/engine'

/** Which model/IR is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

/** Slimming options returned by a loaded slimmable model. */
export interface SlimmableInfo {
  breakpoints: number[]
  currentSize: number
}

/**
 * One mono amp+cab signal chain: NAM amp model -> tone stack -> cabinet IR
 * (parallel wet/dry via ConvolverNode). Two of these, panned hard left/right,
 * form the dual-chain stereo rig.
 *
 * The tone stack is a 4-band EQ (Bass low-shelf, Mid peaking, Treble
 * high-shelf, Presence peaking) placed between the amp output and the cab IR
 * so it colours both the amp model and the cab — the same as a real amp's
 * tone controls before the speaker.
 */
export class AmpCabChain {
  private readonly context: BaseAudioContext
  private readonly namNode: NamNode
  private readonly input: GainNode
  private readonly output: GainNode
  private readonly irWetGain: GainNode
  private readonly irDryGain: GainNode
  private irNode: ConvolverNode | null = null
  private disposed = false
  private irMix = 0
  private loadedModel: LoadedAssetInfo | null = null
  private loadedIr: LoadedAssetInfo | null = null
  private modelJson: string | null = null
  private slimmable: SlimmableInfo | null = null
  /** Tone stack filter nodes placed between amp and IR. */
  private readonly bassFilter: BiquadFilterNode
  private readonly midFilter: BiquadFilterNode
  private readonly trebleFilter: BiquadFilterNode
  private readonly presenceFilter: BiquadFilterNode
  private bassGain = 0
  private midGain = 0
  private trebleGain = 0
  private presenceGain = 0

  private constructor(context: BaseAudioContext, namNode: NamNode) {
    this.context = context
    this.namNode = namNode
    this.input = new GainNode(context)
    this.output = new GainNode(context)
    this.irWetGain = new GainNode(context, { gain: 1 })
    this.irDryGain = new GainNode(context, { gain: 0 })

    // Build the tone stack: Bass (low-shelf) → Mid (peaking) → Treble (high-shelf) → Presence (peaking).
    this.bassFilter = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 100, gain: 0 })
    this.midFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 1000,
      Q: 0.7,
      gain: 0,
    })
    this.trebleFilter = new BiquadFilterNode(context, {
      type: 'highshelf',
      frequency: 5000,
      gain: 0,
    })
    this.presenceFilter = new BiquadFilterNode(context, {
      type: 'peaking',
      frequency: 8000,
      Q: 0.5,
      gain: 0,
    })

    this.input.connect(namNode)
    namNode.connect(this.bassFilter)
    this.bassFilter.connect(this.midFilter)
    this.midFilter.connect(this.trebleFilter)
    this.trebleFilter.connect(this.presenceFilter)
    // The tone stack output splits to the dry path and (lazily) the IR wet path.
    this.presenceFilter.connect(this.irDryGain)
    this.irDryGain.connect(this.output)
    this.irWetGain.connect(this.output)
  }

  /** Create a chain on a shared NamEngine. */
  static async create(context: BaseAudioContext, engine: NamEngine): Promise<AmpCabChain> {
    const namNode = await engine.createNode()
    return new AmpCabChain(context, namNode)
  }

  get inputNode(): AudioNode {
    return this.input
  }

  get outputNode(): AudioNode {
    return this.output
  }

  // ── Amp model loading ──────────────────────────────────────────────────────

  async loadModel(json: string, slimSize?: number, info?: LoadedAssetInfo): Promise<NamModelInfo> {
    const modelInfo = await this.namNode.loadModel(
      json,
      slimSize === undefined ? undefined : { slimSize },
    )
    this.modelJson = json
    this.loadedModel = info ?? null
    if (modelInfo.slimmable && modelInfo.slimmableBreakpoints) {
      this.slimmable = {
        breakpoints: modelInfo.slimmableBreakpoints,
        currentSize: slimSize ?? 1,
      }
    } else {
      this.slimmable = null
    }
    return modelInfo
  }

  /** Re-load the currently loaded model with a different slim size. No-op if not slimmable. */
  async setModelSlimSize(slimSize: number): Promise<void> {
    if (!this.modelJson || !this.slimmable) return
    const clamped = Math.min(1, Math.max(0.01, slimSize))
    await this.namNode.loadModel(this.modelJson, { slimSize: clamped })
    this.slimmable.currentSize = clamped
  }

  /** Information about slimming support for the currently loaded model, or null. */
  getSlimmableInfo(): SlimmableInfo | null {
    return this.slimmable
  }

  async unloadModel(): Promise<void> {
    await this.namNode.unloadModel()
    this.loadedModel = null
    this.modelJson = null
    this.slimmable = null
  }

  getLoadedModel(): LoadedAssetInfo | null {
    return this.loadedModel
  }

  // ── Tone stack controls ────────────────────────────────────────────────────

  /** Set Bass shelf gain in dB (±12). */
  setBass(gain: number): void {
    this.bassGain = Math.min(12, Math.max(-12, gain))
    this.bassFilter.gain.setTargetAtTime(this.bassGain, this.context.currentTime, 0.01)
  }

  getBass(): number {
    return this.bassGain
  }

  /** Set Mid peaking gain in dB (±12). */
  setMid(gain: number): void {
    this.midGain = Math.min(12, Math.max(-12, gain))
    this.midFilter.gain.setTargetAtTime(this.midGain, this.context.currentTime, 0.01)
  }

  getMid(): number {
    return this.midGain
  }

  /** Set Treble shelf gain in dB (±12). */
  setTreble(gain: number): void {
    this.trebleGain = Math.min(12, Math.max(-12, gain))
    this.trebleFilter.gain.setTargetAtTime(this.trebleGain, this.context.currentTime, 0.01)
  }

  getTreble(): number {
    return this.trebleGain
  }

  /** Set Presence peaking gain in dB (±12). */
  setPresence(gain: number): void {
    this.presenceGain = Math.min(12, Math.max(-12, gain))
    this.presenceFilter.gain.setTargetAtTime(this.presenceGain, this.context.currentTime, 0.01)
  }

  getPresence(): number {
    return this.presenceGain
  }

  // ── Cab IR ─────────────────────────────────────────────────────────────────

  loadIR(audioBuffer: AudioBuffer, mix = 1, info?: LoadedAssetInfo): void {
    const newIrNode = new ConvolverNode(this.context, { buffer: audioBuffer })
    // Wire the IR after the tone stack so EQ colours both amp and cab.
    this.presenceFilter.connect(newIrNode)
    newIrNode.connect(this.irWetGain)

    this.irNode?.disconnect()
    this.irNode = newIrNode
    this.loadedIr = info ?? null
    this.setIrMix(mix)
  }

  getLoadedIr(): LoadedAssetInfo | null {
    return this.loadedIr
  }

  setIrMix(mix: number): void {
    this.irMix = Math.min(1, Math.max(0, mix))
    const now = this.context.currentTime
    this.irWetGain.gain.setTargetAtTime(this.irMix, now, 0.01)
    this.irDryGain.gain.setTargetAtTime(1 - this.irMix, now, 0.01)
  }

  getIrMix(): number {
    return this.irMix
  }

  clearIR(): void {
    this.irNode?.disconnect()
    this.irNode = null
    this.loadedIr = null
    this.setIrMix(0)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.irNode?.disconnect()
    this.input.disconnect()
    this.output.disconnect()
    this.irWetGain.disconnect()
    this.irDryGain.disconnect()
    this.bassFilter.disconnect()
    this.midFilter.disconnect()
    this.trebleFilter.disconnect()
    this.presenceFilter.disconnect()
    await this.namNode.dispose()
  }
}
