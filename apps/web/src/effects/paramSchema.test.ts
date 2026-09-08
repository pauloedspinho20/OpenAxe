import { describe, expect, it } from 'vitest'
import { getParamSchema } from './paramSchema'

/** The per-block Input/Output trim knobs read in dB, not percent. */
describe('I/O trim knob labels', () => {
  function trimFormat(key: 'input_level' | 'output_level'): (v: number) => string {
    const field = getParamSchema('amp').find((f) => f.key === key)
    expect(field?.control).toBe('knob')
    if (field?.control !== 'knob') throw new Error(`missing ${key} knob`)
    return field.formatValue
  }

  it.each([['input_level'], ['output_level']] as const)(
    'the %s knob formats unity as 0.0dB',
    (key) => {
      expect(trimFormat(key)(1)).toBe('0.0dB')
    },
  )

  it('formats boost with an explicit + and cuts with −', () => {
    const format = trimFormat('input_level')
    expect(format(1.5)).toBe('+3.5dB')
    expect(format(0.5)).toBe('−6.0dB')
  })

  it('formats silence as −∞dB rather than -inf', () => {
    expect(trimFormat('output_level')(0)).toBe('−∞dB')
  })
})
