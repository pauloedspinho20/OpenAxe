import type { EffectParams } from '../effects/Effect'
import { mapStringParam } from '../effects/stringParamMaps'
import type { BlockKind } from './blocks/Block'
import type { PresetBlock } from '../presets/types'
import type { RigBlockPort, RigModelInfo } from './RigWorkletNode'

/**
 * A block facade the web rig exposes to the UI. Mirrors NativeBlock exactly
 * (the desktop path's facade) but drives the single rig worklet instead of the
 * desktop bridge - so web and desktop present the same PresetBlock/BlockLoadTarget
 * surface over the same core. It intentionally does NOT satisfy `Block` (which
 * requires input/output AudioNodes): the real DSP lives in the one core graph
 * inside the rig worklet, and consumers use the PresetBlock/BlockLoadTarget
 * surface via duck-typing, so a cast at the rig boundary is the only concession
 * (the same one NativeGraphRig makes).
 *
 * The per-block Input/Output knobs route to the core's own I/O trims
 * (openaxe_set_block_{input,output}_trim), not to params - see setParams.
 */
export class RigBlock implements PresetBlock {
  readonly kind: BlockKind
  private readonly worklet: RigBlockPort
  private readonly id: string
  private params: EffectParams = {}
  private bypassed = false
  private loadedModel: { id: string; name: string } | null = null
  private loadedIr: { id: string; name: string } | null = null

  constructor(worklet: RigBlockPort, id: string, kind: BlockKind) {
    this.worklet = worklet
    this.id = id
    this.kind = kind
  }

  getParams(): EffectParams {
    return { ...this.params }
  }

  setParams(params: EffectParams): void {
    // Slim is hidden per-block; drop any persisted slim keys so presets stay at max.
    const {
      slim_size: _slimSnake,
      slimSize: _slimCamel,
      ...rest
    } = params as Record<string, unknown>
    void _slimSnake
    void _slimCamel
    this.params = { ...(rest as EffectParams) }

    // The Input/Output knobs are block I/O trims, not DSP params. They must not
    // go through setParam: the core's input_level/output_level params exist only
    // on the Amp family and hold the loaded model's dBu calibration.
    const input = params.input_level
    const output = params.output_level
    const inputTrim = typeof input === 'number' ? input : undefined
    const outputTrim = typeof output === 'number' ? output : undefined
    if (inputTrim !== undefined || outputTrim !== undefined) {
      this.worklet.setTrim(this.id, inputTrim, outputTrim)
    }

    for (const [key, value] of Object.entries(params)) {
      if (key === 'input_level' || key === 'output_level') continue
      // Slim size is intentionally not per-block adjustable in the inspector
      // (paramSchema hides the knob); slimmable models always run at max
      // quality (1). Any persisted slim_size/ slimSize from older presets is
      // ignored here so the block stays at max via its loadModel default.
      if (key === 'slim_size' || key === 'slimSize') continue
      // The reverb algorithm is a select (hall/room/plate/early-reflections),
      // not a numeric param - it has no core symbol and must go through
      // openaxe_set_reverb_algorithm. Reverb control knobs (roomSize/
      // damping/...) are routed by the worklet through the core's ReverbControl
      // mapping on setParam, so they stay generic.
      if (key === 'reverbAlgorithm' && typeof value === 'string') {
        this.worklet.setReverbAlgorithm(this.id, value)
        continue
      }
      if (key === 'model' && typeof value === 'string') {
        // Delay model string select — map to numeric and go through setParam
        // (worklet resolves "model" symbol to the correct index). NativeBlock
        // uses the dedicated setDelayModel path; either works as long as the
        // string is mapped to 0/1/2.
        const map: Record<string, number> = { digital: 0, analog: 1, tape: 2 }
        this.worklet.setParam(this.id, key, map[value] ?? 0)
        continue
      }
      // shape/character and the Phase-2 select params are string selects backed
      // by numeric core params - one shared map module (issue #268), so web and
      // desktop can't drift. Non-enum strings are forwarded only when numeric;
      // anything else is skipped, not silently zeroed.
      if (typeof value === 'string') {
        const mapped = mapStringParam(this.kind, key, value)
        if (mapped !== undefined) {
          this.worklet.setParam(this.id, key, mapped)
          continue
        }
        const n = Number.parseFloat(value)
        if (!Number.isFinite(n)) continue
        this.worklet.setParam(this.id, key, n)
        continue
      }
      const num = toNumber(value)
      this.worklet.setParam(this.id, key, num)
    }
  }

  isBypassed(): boolean {
    return this.bypassed
  }

  setBypass(bypassed: boolean): void {
    this.bypassed = bypassed
    this.worklet.setBypass(this.id, bypassed)
  }

  getLoadedModel(): { id: string; name: string } | null {
    return this.loadedModel
  }

  loadModel(
    json: string,
    slimSize: number | undefined,
    info: { id: string; name: string },
  ): Promise<RigModelInfo> {
    return this.doLoadModel(json, slimSize, info)
  }

  private async doLoadModel(
    json: string,
    slimSize: number | undefined,
    info: { id: string; name: string },
  ): Promise<RigModelInfo> {
    const result = await this.worklet.loadModel(this.id, json, slimSize)
    this.loadedModel = info
    return result
  }

  async unloadModel(): Promise<void> {
    await this.worklet.unloadModel(this.id)
    this.loadedModel = null
  }

  /** Re-slim the currently loaded model (see AmpBlock.setModelSlimSize). */
  async setModelSlimSize(slimSize: number): Promise<void> {
    await this.worklet.setSlimSize(this.id, slimSize)
  }

  getLoadedIr(): { id: string; name: string } | null {
    return this.loadedIr
  }

  /** Install a cab IR from a decoded AudioBuffer (folded to mono, at context rate). */
  loadIR(buffer: AudioBuffer, mix?: number, info?: { id: string; name: string }): void {
    this.loadedIr = info ?? null
    if (typeof mix === 'number') {
      this.params = { ...this.params, irMix: mix }
      this.worklet.setParam(this.id, 'irMix', mix)
    }
    const samples = toMonoSamples(buffer)
    void this.worklet.loadIr(this.id, samples).catch(() => {
      this.loadedIr = null
    })
  }

  clearIR(): void {
    this.loadedIr = null
    void this.worklet.unloadIr(this.id)
  }

  /**
   * Cache transfer for GraphRig.adoptStage (issue #367): snapshot carries
   * the already-live values, restore replays them onto a fresh live facade
   * WITHOUT touching the worklet (the commit already made them live).
   */
  snapshotBlockState(): {
    params: EffectParams
    bypassed: boolean
    loadedModel: { id: string; name: string } | null
    loadedIr: { id: string; name: string } | null
  } {
    return {
      params: { ...this.params },
      bypassed: this.bypassed,
      loadedModel: this.loadedModel ? { ...this.loadedModel } : null,
      loadedIr: this.loadedIr ? { ...this.loadedIr } : null,
    }
  }

  restoreBlockState(snapshot: {
    params: EffectParams
    bypassed: boolean
    loadedModel: { id: string; name: string } | null
    loadedIr: { id: string; name: string } | null
  }): void {
    this.params = { ...snapshot.params }
    this.bypassed = snapshot.bypassed
    this.loadedModel = snapshot.loadedModel ? { ...snapshot.loadedModel } : null
    this.loadedIr = snapshot.loadedIr ? { ...snapshot.loadedIr } : null
  }
}

/** Coerce an EffectParams value (number | string | boolean) to a float the core expects. */
function toNumber(v: number | string | boolean): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Fold an IR down to the mono buffer the core takes (see CabIrNode). */
function toMonoSamples(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice()
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0)
  }
  const scale = 1 / buffer.numberOfChannels
  for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) * scale
  return mono
}
