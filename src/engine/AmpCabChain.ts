import { NamEngine, NamNode, type NamModelInfo } from 'neural-amp-modeler-wasm/engine'

/** Which model/IR is currently loaded, for saving into a preset. Null if none is loaded. */
export interface LoadedAssetInfo {
  id: string
  name: string
}

/**
 * One mono amp+cab signal chain: NAM amp model -> cabinet IR (parallel wet/dry
 * via ConvolverNode, since NAM's wasm engine only models the amp, not the
 * cabinet). Two of these, panned hard left/right, form the dual-chain stereo
 * rig (see the Dual Signal-Chain epic).
 *
 * Model hot-swapping and its click-free fade-in are handled inside the NAM
 * worklet itself (see NamNode.loadModel upstream) - this wrapper doesn't need
 * to reimplement that.
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

  private constructor(context: BaseAudioContext, namNode: NamNode) {
    this.context = context
    this.namNode = namNode
    this.input = new GainNode(context)
    this.output = new GainNode(context)
    this.irWetGain = new GainNode(context, { gain: 1 })
    this.irDryGain = new GainNode(context, { gain: 0 })

    this.input.connect(namNode)
    // Dry path (no IR loaded yet): amp -> dry gain -> output.
    namNode.connect(this.irDryGain)
    this.irDryGain.connect(this.output)
    // Wet path is connected lazily once an IR is loaded (see loadIR).
    this.irWetGain.connect(this.output)
  }

  /**
   * Create a chain on a shared NamEngine. Call NamEngine.attach(context) once
   * per AudioContext and pass the result here for each chain you need (e.g.
   * twice, for the left/right dual-chain rig) - they share one wasm module.
   */
  static async create(context: BaseAudioContext, engine: NamEngine): Promise<AmpCabChain> {
    const namNode = await engine.createNode()
    return new AmpCabChain(context, namNode)
  }

  /** Chain input node - connect your source (input gain, pedal chain, etc.) here. */
  get inputNode(): AudioNode {
    return this.input
  }

  /** Chain output node - connect to the stereo mixer/master bus. */
  get outputNode(): AudioNode {
    return this.output
  }

  /**
   * Load a `.nam` model from its JSON file contents. Fades in over ~21ms, click-free.
   * @param info Identifies the model (e.g. a Tone3000 id/name), so a preset can record which one
   *   is loaded and later reload it. Omit for one-off/test loads that don't need to be recalled.
   */
  async loadModel(json: string, slimSize?: number, info?: LoadedAssetInfo): Promise<NamModelInfo> {
    const modelInfo = await this.namNode.loadModel(
      json,
      slimSize === undefined ? undefined : { slimSize },
    )
    this.loadedModel = info ?? null
    return modelInfo
  }

  async unloadModel(): Promise<void> {
    await this.namNode.unloadModel()
    this.loadedModel = null
  }

  /** Which model is currently loaded, or null if none is (or it wasn't loaded with an id/name). */
  getLoadedModel(): LoadedAssetInfo | null {
    return this.loadedModel
  }

  /**
   * Load a cabinet impulse response and cross-fade the wet/dry mix.
   * @param audioBuffer Decoded IR audio (see AudioContext.decodeAudioData).
   * @param mix Wet/dry mix in [0, 1], 1 = fully wet (IR only). Defaults to fully wet.
   * @param info Identifies the IR, same purpose as loadModel's `info`.
   */
  loadIR(audioBuffer: AudioBuffer, mix = 1, info?: LoadedAssetInfo): void {
    const newIrNode = new ConvolverNode(this.context, { buffer: audioBuffer })
    this.namNode.connect(newIrNode)
    newIrNode.connect(this.irWetGain)

    this.irNode?.disconnect()
    this.irNode = newIrNode
    this.loadedIr = info ?? null
    this.setIrMix(mix)
  }

  /** Which IR is currently loaded, or null if none is (or it wasn't loaded with an id/name). */
  getLoadedIr(): LoadedAssetInfo | null {
    return this.loadedIr
  }

  /** Adjust the cabinet wet/dry mix without reloading the IR. */
  setIrMix(mix: number): void {
    this.irMix = Math.min(1, Math.max(0, mix))
    const now = this.context.currentTime
    this.irWetGain.gain.setTargetAtTime(this.irMix, now, 0.01)
    this.irDryGain.gain.setTargetAtTime(1 - this.irMix, now, 0.01)
  }

  getIrMix(): number {
    return this.irMix
  }

  /** Remove the cabinet IR; the chain passes the amp's raw output through. */
  clearIR(): void {
    this.irNode?.disconnect()
    this.irNode = null
    this.loadedIr = null
    this.setIrMix(0)
  }

  /** Destroy the chain's wasm instance and disconnect every node. Not reusable afterwards. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.irNode?.disconnect()
    this.input.disconnect()
    this.output.disconnect()
    this.irWetGain.disconnect()
    this.irDryGain.disconnect()
    await this.namNode.dispose()
  }
}
