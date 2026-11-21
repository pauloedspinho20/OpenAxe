import { describe, expect, it } from 'vitest'
import { getMixerParamSchema, getParamSchema } from './paramSchema'
import type { BlockInstance, EdgeInstance } from '../state/graphStore'

function mixerBlock(id: string): BlockInstance {
  return { id, kind: 'mixer', row: 0, col: 4, params: {} }
}

function sourceBlock(id: string, kind: BlockInstance['kind']): BlockInstance {
  return { id, kind, row: 0, col: 2, params: {} }
}

function edge(id: string, fromId: string, toId: string, port: number): EdgeInstance {
  return { id, from: { blockId: fromId, port: 0 }, to: { blockId: toId, port } }
}

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

describe('getMixerParamSchema', () => {
  it('labels a connected input by its source block', () => {
    const mixer = mixerBlock('m')
    const delay = sourceBlock('d', 'delay')
    const schema = getMixerParamSchema('m', [mixer, delay], [edge('e1', 'd', 'm', 0)])
    expect(schema.find((f) => f.key === 'in0_level')).toMatchObject({
      label: 'Delay Volume',
      disabled: false,
    })
    expect(schema.find((f) => f.key === 'in0_pan')).toMatchObject({
      label: 'Delay Pan',
      disabled: false,
    })
  })

  it('labels a Send/Return relay by its pair, not its return kind', () => {
    const mixer = mixerBlock('m')
    const ret = sourceBlock('r', 'return-1')
    const schema = getMixerParamSchema('m', [mixer, ret], [edge('e1', 'r', 'm', 0)])
    expect(schema.find((f) => f.key === 'in0_level')).toMatchObject({ label: 'Send 1 Volume' })
    expect(schema.find((f) => f.key === 'in0_pan')).toMatchObject({ label: 'Send 1 Pan' })
  })

  it('disables an input with no connected block but keeps its numbered label', () => {
    const mixer = mixerBlock('m')
    const schema = getMixerParamSchema('m', [mixer], [])
    expect(schema.find((f) => f.key === 'in2_level')).toMatchObject({
      label: 'Level 3',
      disabled: true,
    })
    expect(schema.find((f) => f.key === 'in2_pan')).toMatchObject({
      label: 'Pan 3',
      disabled: true,
    })
  })

  it('keeps a numbered label but stays enabled for an IN-rail-fed input', () => {
    const mixer = mixerBlock('m')
    const schema = getMixerParamSchema('m', [mixer], [edge('e1', 'IN', 'm', 0)])
    expect(schema.find((f) => f.key === 'in0_level')).toMatchObject({
      label: 'Level 1',
      disabled: false,
    })
  })
})
