import type { EffectParams } from '../effects/Effect'
import { mapStringParam } from '../effects/stringParamMaps'
import type { BlockKind } from '../engine/blocks/Block'
import type { PresetBlock } from '../presets/types'
import { isNativeAudioBuffer } from './NativeAudioContext'
import type { OpenAxeBridge } from './openaxe'

/**
 * Base64-encode the IR's bytes for the JSON bridge. Binary can't cross a webview
 * bind, and base64's 33% overhead is far cheaper than a JSON array of numbers -
 * this runs once per IR load, not per buffer.
 */
function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  // Chunked so a multi-megabyte IR can't blow the argument limit of String.
  const chunk = 0x8000
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk))
  }
  return btoa(binary)
}

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
 * C++ core, driven through `window.openAxe`. It intentionally does NOT
 * satisfy `Block` (which requires input/output AudioNodes); consumers use the
 * `PresetBlock`/`BlockLoadTarget` surface via duck-typing, so a cast at the
 * rig boundary is the only concession needed.
 *
 * The per-block Input/Output knobs are routed to the core's own I/O trims
 * (`setBlockTrim`), not to params - see setParams.
 *
 * Limitations (documented, issue #15 M3):
 * - IR/Cab blocks convolve for real now (dsp/convolver.cpp): loadIR forwards the
 *   file's bytes to the core, which decodes and resamples them
 *   (openaxe_load_ir_wav).
 * - Params apply by core param *symbol*. Issue #51's shared schema
 *   (packages/core/param_schema.json, generating both the C++ .inc fragments
 *   and this app's paramSchema.ts, checked by paramSchema.coreDrift.test.ts)
 *   keeps every plain-symbol effect kind's web keys identical to the core's
 *   table - covered end-to-end (bridge resolution, not just static schema
 *   equality) by TestSymbolMappedParamRoundTripAllEffectKinds in
 *   apps/desktop/tests/bridge_test.cpp. Kinds that don't map 1:1 route
 *   through their own dedicated bridge call instead of setParam: reverb
 *   knobs (openaxe_set_reverb_control), reverbAlgorithm/model (delay)
 *   string selects (setReverbAlgorithm/setDelayModel), and the
 *   input_level/output_level I/O trims above (setBlockTrim, which collide in
 *   name but not meaning with the Amp family's core dBu-calibration params
 *   of the same symbol). slimSize/irMix are camelCase aliases resolved by
 *   the bridge (CoreSymbolAliasFor). A key that reaches setParam and still
 *   finds no matching symbol (a typo, or a new UI field added without its
 *   core counterpart) is a genuine gap, not one of the above - the bridge
 *   rejects it and this class surfaces that as a one-time console warning
 *   per block+key (see setParams) rather than silently dropping it (issue
 *   #41).
 */
export class NativeBlock implements PresetBlock {
  readonly kind: BlockKind
  private readonly bridge: OpenAxeBridge
  private readonly id: string
  private params: EffectParams = {}
  private bypassed = false
  private loadedModel: { id: string; name: string } | null = null
  private loadedIr: { id: string; name: string } | null = null
  private readonly unmappedParamsWarned = new Set<string>()

  constructor(bridge: OpenAxeBridge, id: string, kind: BlockKind) {
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
      // The reverb algorithm and delay model are string selects with no core
      // symbol - they must go through their dedicated bridge calls
      // (openaxe_set_reverb_algorithm / openaxe_set_delay_model), not
      // setParam, which would reject the key and silently drop the knob.
      if (key === 'reverbAlgorithm' && typeof value === 'string') {
        void this.bridge.setReverbAlgorithm({ blockId: this.id, algorithm: value })
        continue
      }
      if (key === 'model' && typeof value === 'string') {
        void this.bridge.setDelayModel({ blockId: this.id, model: value })
        continue
      }
      // Character/shape and the Phase-2 select params are string selects
      // backed by numeric core params; map the UI string to the core numeric
      // before sending (shared map module, so web + desktop can't drift).
      let mappedValue: string | number | boolean = value
      if (typeof value === 'string') {
        const mapped = mapStringParam(this.kind, key, value)
        if (mapped !== undefined) {
          mappedValue = mapped
        } else {
          // Not an enum select: forward numeric strings, skip everything else
          // (a silent 0 would be misread by the core as the first enum).
          const n = Number.parseFloat(value)
          if (!Number.isFinite(n)) continue
          mappedValue = n
        }
      }
      void this.bridge
        .setParam({ blockId: this.id, key, value: toNumber(mappedValue) })
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
    return this.loadedIr
  }

  /**
   * Install a cab IR. The buffer carries the file's raw bytes rather than decoded
   * samples (see NativeAudioBuffer) because nothing on this path can decode
   * audio - the core does it, along with resampling to the stream's rate.
   */
  loadIR(buffer: AudioBuffer, mix?: number, info?: { id: string; name: string }): void {
    if (!isNativeAudioBuffer(buffer)) {
      console.warn('[native] loadIR was given a decoded AudioBuffer with no file bytes; ignoring')
      return
    }
    this.loadedIr = info ?? null
    if (typeof mix === 'number') {
      this.params = { ...this.params, irMix: mix }
      void this.bridge.setParam({ blockId: this.id, key: 'irMix', value: mix })
    }
    void this.bridge
      .loadIrWav({ blockId: this.id, wavBase64: toBase64(buffer.nativeFileBytes) })
      .then((result) => {
        if (result.ok) return
        this.loadedIr = null
        console.warn(
          `[native] the core could not load this impulse response${result.error ? `: ${result.error}` : ''}`,
        )
      })
  }

  clearIR(): void {
    this.loadedIr = null
    void this.bridge.unloadIr({ blockId: this.id })
  }
}
