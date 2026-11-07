// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { EffectParamsPanel } from './EffectParamsPanel'
import { useGraphStore } from '@/state/graphStore'
import { useMidiStore } from '@/state/midiStore'
import type { Block } from '@/engine/blocks/Block'

function fakeBlock(): Block {
  return {
    kind: 'chorus',
    inputNode: {} as AudioNode,
    outputNode: {} as AudioNode,
    getParams: () => ({}),
    setParams: () => {},
    dispose: () => {},
  }
}

function fakeMixerBlock(): Block {
  return {
    kind: 'mixer',
    inputNode: {} as AudioNode,
    outputNode: {} as AudioNode,
    getParams: () => ({}),
    setParams: () => {},
    dispose: () => {},
  }
}

describe('EffectParamsPanel MIDI-learn highlight', () => {
  afterEach(() => {
    useMidiStore.setState({ learning: null })
  })

  it('tints only the knob armed for MIDI learn with the accent base', () => {
    useGraphStore.setState({
      blocks: [{ id: 'b1', kind: 'chorus', row: 0, col: 0, params: {} }],
      edges: [],
    })
    render(<EffectParamsPanel blockId="b1" block={fakeBlock()} />)

    // Nothing armed - every knob keeps its default grey base.
    expect(screen.getByRole('slider', { name: 'Mix' }).getAttribute('class')).not.toMatch(
      /highlighted/,
    )

    act(() => {
      useMidiStore.setState({
        learning: {
          actionKey: 'param:b1:mix',
          action: { kind: 'param', blockId: 'b1', paramKey: 'mix' },
        },
      })
    })

    expect(screen.getByRole('slider', { name: 'Mix' }).getAttribute('class')).toMatch(/highlighted/)
    expect(screen.getByRole('slider', { name: 'Rate' }).getAttribute('class')).not.toMatch(
      /highlighted/,
    )
  })
})

describe('EffectParamsPanel mixer labels', () => {
  afterEach(() => {
    useGraphStore.setState({ blocks: [], edges: [] })
  })

  it('labels connected inputs by their source block and disables unconnected ones', () => {
    useGraphStore.setState({
      blocks: [
        { id: 'mix', kind: 'mixer', row: 0, col: 3, params: {} },
        { id: 'del', kind: 'delay', row: 0, col: 1, params: {} },
      ],
      edges: [{ id: 'e1', from: { blockId: 'del', port: 0 }, to: { blockId: 'mix', port: 0 } }],
    })
    render(<EffectParamsPanel blockId="mix" block={fakeMixerBlock()} />)

    const delayLevel = screen.getByRole('slider', { name: 'Delay Volume' })
    const delayPan = screen.getByRole('slider', { name: 'Delay Pan' })
    expect(delayLevel).toHaveAttribute('aria-disabled', 'false')
    expect(delayPan).toHaveAttribute('aria-disabled', 'false')

    // Input 3 (index 2) has no cable - numbered label stays, knobs are disabled.
    const level3 = screen.getByRole('slider', { name: 'Level 3' })
    const pan3 = screen.getByRole('slider', { name: 'Pan 3' })
    expect(level3).toHaveAttribute('aria-disabled', 'true')
    expect(pan3).toHaveAttribute('aria-disabled', 'true')
  })
})
