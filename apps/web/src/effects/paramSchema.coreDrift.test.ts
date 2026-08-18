import { describe, expect, it } from 'vitest'
import coreSchema from '../../../../packages/core/param_schema.json'
import { EFFECT_PARAM_SCHEMAS } from './paramSchema'
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
const SYMBOL_KINDS = Object.keys(coreEffects).filter(
  (kind): kind is EffectKind => kind !== 'amp' && kind !== 'reverb' && kind in EFFECT_PARAM_SCHEMAS,
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
  it('covers every effect kind the core implements', () => {
    // Every core effect kind is either compared symbol-by-symbol below or is
    // one of the two documented exceptions (amp, reverb).
    expect(SYMBOL_KINDS.length).toBe(Object.keys(coreEffects).length - 2)
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
