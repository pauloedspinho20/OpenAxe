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
