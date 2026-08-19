import { describe, expect, it } from 'vitest'
import coreSchema from '../../../../packages/core/param_schema.json'
import { BLOCK_PARAM_SCHEMAS, EFFECT_PARAM_SCHEMAS } from './paramSchema'
import type { EffectKind } from './Effect'

/**
 * packages/core/param_schema.json is the single source of truth for effect
 * param symbols and ranges (issue #51), but only the C++ fragments and the
 * worklets' symbol->index map are generated from it - the UI's knob ranges in
 * paramSchema.ts are still hand-written. Nothing else fails when the two drift,
 * and the symptom is a knob whose travel doesn't match what the DSP accepts, or
 * a param that silently doesn't exist in the core at all. This test is the
 * guard until the ranges themselves are generated.
 *
 * Ranges are compared per effect kind, since symbols like `rate`/`depth`/
 * `feedback` recur across kinds with different ranges.
 */
interface CoreParam {
  symbol: string
  label: string
  min: number
  max: number
  unit: string
}
interface CoreEffect {
  params?: CoreParam[]
  variants?: Record<string, { params: CoreParam[] }>
}

const coreEffects = coreSchema.effects as unknown as Record<string, CoreEffect>

/** Flattened core params for one kind - variants (reverb algorithms) are unioned by symbol. */
function coreParamsFor(kind: string): Map<string, CoreParam> {
  const def = coreEffects[kind]
  const out = new Map<string, CoreParam>()
  for (const p of def?.params ?? []) out.set(p.symbol, p)
  for (const variant of Object.values(def?.variants ?? {})) {
    for (const p of variant.params) if (!out.has(p.symbol)) out.set(p.symbol, p)
  }
  return out
}

/** Web knob/select fields for one kind, keyed by param symbol. */
function webFieldsFor(kind: EffectKind): Map<string, { min?: number; max?: number }> {
  const out = new Map<string, { min?: number; max?: number }>()
  for (const field of EFFECT_PARAM_SCHEMAS[kind] ?? []) {
    out.set(field.key, field.control === 'knob' ? { min: field.min, max: field.max } : {})
  }
  return out
}

// Kinds whose UI fields are core param symbols 1:1. Excluded:
// - `amp`, which lives in BLOCK_PARAM_SCHEMAS and whose input_level/
//   output_level are the loaded model's dBu calibration rather than knobs
//   (the Input/Output knobs are core I/O trims - see NativeBlock).
// - `reverb`, whose knobs are deliberately NOT symbols: they are the
//   ReverbControl abstraction in packages/core (room size -> the current
//   algorithm's decay, damping -> its high cut, pre-delay -> `delay` on Hall
//   but `predelay` on Room, ...). Covered by its own case below.
// - `cab`, whose single param also lives in BLOCK_PARAM_SCHEMAS, under a
//   camelCase key. Covered by its own case below too.
const EXCLUDED_KINDS = ['amp', 'reverb', 'cab']
const SYMBOL_KINDS = Object.keys(coreEffects).filter(
  (kind): kind is EffectKind => !EXCLUDED_KINDS.includes(kind) && kind in EFFECT_PARAM_SCHEMAS,
)

// The controls packages/core's ReverbControl enum defines, in its order.
const REVERB_CONTROLS = [
  'roomSize',
  'damping',
  'width',
  'predelay',
  'spin',
  'wander',
  'earlySend',
  'dryLevel',
]

describe('paramSchema vs packages/core/param_schema.json', () => {
  it("the amp's tone stack matches the core's own ToneStack params", () => {
    const core = coreParamsFor('amp')
    const web = new Map(
      (BLOCK_PARAM_SCHEMAS.amp ?? []).map((field) => [
        field.key,
        field.control === 'knob' ? { min: field.min, max: field.max } : {},
      ]),
    )
    for (const symbol of ['bass', 'mid', 'treble', 'presence']) {
      expect(core.has(symbol), `core has no ${symbol} param`).toBe(true)
      expect({ symbol, ...web.get(symbol) }).toEqual({
        symbol,
        min: core.get(symbol)!.min,
        max: core.get(symbol)!.max,
      })
    }
  })

  it("the amp's Input/Output knobs are trims, not the core's calibration params", () => {
    // Both sides happen to use the symbols `input_level`/`output_level`, but they
    // mean different things: in the core they are the loaded capture's dBu
    // calibration (-100..100 dBu), while the UI's knobs are linear I/O trims
    // (0..1.5) that route to nam_studio_set_block_{input,output}_trim instead.
    // This asserts the mismatch is the known, deliberate one - if the ranges ever
    // coincide, someone has conflated them.
    const core = coreParamsFor('amp')
    const web = new Map(
      (BLOCK_PARAM_SCHEMAS.amp ?? []).map((field) => [
        field.key,
        field.control === 'knob' ? { min: field.min, max: field.max } : {},
      ]),
    )
    for (const symbol of ['input_level', 'output_level']) {
      expect(web.get(symbol)).toEqual({ min: 0, max: 1.5 })
      expect(core.get(symbol)!.unit).toBe('dBu')
    }
  })

  it('covers every effect kind the core implements', () => {
    // Every core effect kind is either compared symbol-by-symbol below or is one
    // of the documented exceptions in EXCLUDED_KINDS.
    expect(SYMBOL_KINDS.length).toBe(Object.keys(coreEffects).length - EXCLUDED_KINDS.length)
  })

  it("the cab's IR mix knob matches the core's ir_mix param", () => {
    // The UI key is camelCase (`irMix`) where the core symbol is snake_case
    // (`ir_mix`) - the bridge aliases it, the same way it does `slimSize`. The
    // range has to agree either way.
    const core = coreParamsFor('cab').get('ir_mix')
    expect(core).toBeDefined()
    const web = (BLOCK_PARAM_SCHEMAS.cab ?? []).find((field) => field.key === 'irMix')
    expect(web?.control).toBe('knob')
    if (web?.control === 'knob') {
      expect({ min: web.min, max: web.max }).toEqual({ min: core!.min, max: core!.max })
    }
  })

  it('reverb knobs are exactly the core ReverbControl set', () => {
    const web = [...webFieldsFor('reverb').keys()].filter((key) => key !== 'reverbAlgorithm')
    expect(new Set(web)).toEqual(new Set(REVERB_CONTROLS))
  })

  it.each(SYMBOL_KINDS)('%s: every core param has a UI field with the core range', (kind) => {
    const web = webFieldsFor(kind)
    for (const [symbol, core] of coreParamsFor(kind)) {
      const field = web.get(symbol)
      expect(field, `${kind}.${symbol} has no field in EFFECT_PARAM_SCHEMAS`).toBeDefined()
      if (field?.min === undefined) continue // select control - no numeric range to compare
      expect({ symbol, min: field.min, max: field.max }).toEqual({
        symbol,
        min: core.min,
        max: core.max,
      })
    }
  })

  it.each(SYMBOL_KINDS)('%s: no UI field targets a param the core does not have', (kind) => {
    const core = coreParamsFor(kind)
    // `mix` and the I/O trims are engine-level staging rather than DSP params
    // on some kinds, so they are allowed to have no entry in the core table.
    const staging = new Set(['mix', 'input_level', 'output_level'])
    const unknown = [...webFieldsFor(kind).keys()].filter(
      (key) => !core.has(key) && !staging.has(key),
    )
    expect(unknown).toEqual([])
  })
})
