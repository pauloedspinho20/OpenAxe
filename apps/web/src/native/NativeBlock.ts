import type { EffectParams } from '../effects/Effect'
import type { BlockKind } from '../engine/blocks/Block'
import type { PresetBlock } from '../presets/types'
import type { NamStudioBridge } from './namStudio'

/** Coerce an EffectParams value (number | string | boolean) to a float the core expects. */
function toNumber(v: number | string | boolean): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * A block facade the native engine exposes to the UI. Satisfies the
 * `PresetBlock` slice (capture/apply, model/IR methods) and `BlockLoadTarget`
 * (Tone3000/asset import) without any AudioNode - the real DSP lives in the
 * C++ core, driven through `window.namStudio`. It intentionally does NOT
 * satisfy `Block` (which requires input/output AudioNodes); consumers use the
 * `PresetBlock`/`BlockLoadTarget` surface via duck-typing, so a cast at the
 * rig boundary is the only concession needed.
 *
 * The per-block Input/Output knobs are routed to the core's own I/O trims
 * (`setBlockTrim`), not to params - see setParams.
 *
 * Limitations (documented, issue #15 M3):
 * - IR/Cab loading is a no-op: the core has no cab (convolution) DSP yet, so
 *   cab blocks pass audio through unchanged and `getLoadedIr()` is always null.
 * - Params apply by core param *symbol*; effect params whose symbol doesn't
 *   match the core's table are rejected by the bridge (issue #41). That
 *   rejection is surfaced as a one-time console warning per block+key (see
 *   setParams) rather than silently dropped, ahead of the real fix - a single
 *   param schema shared by web/core/WASM (issue #51).
 */
export class NativeBlock implements PresetBlock {
  readonly kind: BlockKind
  private readonly bridge: NamStudioBridge
  private readonly id: string
  private params: EffectParams = {}
  private bypassed = false
  private loadedModel: { id: string; name: string } | null = null
  private readonly unmappedParamsWarned = new Set<string>()

  constructor(bridge: NamStudioBridge, id: string, kind: BlockKind) {
    this.bridge = bridge
    this.id = id
    this.kind = kind
  }

  getParams(): EffectParams {
    return { ...this.params }
  }

  setParams(params: EffectParams): void {
    this.params = { ...params }

    // The Input/Output knobs are block I/O trims, not DSP params. They must
    // not go through setParam: the core's `input_level`/`output_level` params
    // exist only on the Amp family and hold the loaded model's dBu
    // calibration, so forwarding a 0..1.5 gain there recalibrated the amp
    // (and 0, meaning silence in the UI, read as "0 dBu" = unity) while every
    // other block kind just rejected the symbol.
    const input = params.input_level
    const output = params.output_level
    if (typeof input === 'number' || typeof output === 'number') {
      void this.bridge.setBlockTrim({
        blockId: this.id,
        ...(typeof input === 'number' ? { input } : {}),
        ...(typeof output === 'number' ? { output } : {}),
      })
    }

    for (const [key, value] of Object.entries(params)) {
      if (key === 'input_level' || key === 'output_level') continue
      void this.bridge
        .setParam({ blockId: this.id, key, value: toNumber(value) })
        .then((result) => {
          if (result.ok || this.unmappedParamsWarned.has(key)) return
          // The core rejected this symbol - the knob change never reached the
          // DSP. Warn once per key (a knob drag fires this constantly) so the
          // gap is visible instead of a silent no-op (issue #41).
          this.unmappedParamsWarned.add(key)
          console.warn(
            `[native] "${key}" on ${this.kind} block ${this.id} has no matching core param - ` +
              `the knob has no audible effect on desktop.${result.error ? ` (${result.error})` : ''}`,
          )
        })
    }
  }

  isBypassed(): boolean {
    return this.bypassed
  }

  setBypass(bypassed: boolean): void {
    this.bypassed = bypassed
    void this.bridge.setBypass({ blockId: this.id, bypassed })
  }

  getLoadedModel(): { id: string; name: string } | null {
    return this.loadedModel
  }

  loadModel(
    json: string,
    slimSize: number | undefined,
    info: { id: string; name: string },
  ): Promise<void> {
    return this.doLoadModel(json, slimSize, info)
  }

  private async doLoadModel(
    json: string,
    slimSize: number | undefined,
    info: { id: string; name: string },
  ): Promise<void> {
    const result = await this.bridge.loadModelJson({ blockId: this.id, json })
    if (!result.ok) {
      throw new Error(result.error ?? `loadModel failed (result ${result.result})`)
    }
    this.loadedModel = info
    if (slimSize !== undefined) {
      // Best-effort quality setting; ignored if the model isn't slimmable.
      void this.bridge.setParam({ blockId: this.id, key: 'slim_size', value: slimSize })
    }
  }

  async unloadModel(): Promise<void> {
    await this.bridge.unloadModel({ blockId: this.id })
    this.loadedModel = null
  }

  getLoadedIr(): { id: string; name: string } | null {
    return null
  }

  loadIR(): void {
    // No-op: the core has no cab/convolution DSP (see class doc).
  }

  clearIR(): void {
    // No-op: see loadIR.
  }
}
