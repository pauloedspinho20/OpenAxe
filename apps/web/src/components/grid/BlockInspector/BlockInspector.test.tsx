import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BlockInspector } from './BlockInspector'
import { useGraphStore, type BlockInstance } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'
import type { GraphRig } from '../../../engine/GraphRig'
import type { Block, EffectParams } from '../../../engine/blocks/Block'

function fakeEffectBlock(kind: BlockInstance['kind'], params: EffectParams): Block {
  return {
    kind,
    inputNode: {} as AudioNode,
    outputNode: {} as AudioNode,
    getParams: () => params,
    setParams: () => {},
    dispose: () => {},
  }
}

describe('BlockInspector', () => {
  beforeEach(() => {
    useSelection.getState().clear()
    useGraphStore.getState().loadGraph([], [], 1, false)
  })

  it("shows the selected block's own params, not a previously selected block's stale ones", () => {
    // Regression test: EffectParamsPanel seeds its local `values` state
    // once via useState(() => block.getParams()). Without a `key` tied to
    // the block's identity, React reuses the same component instance
    // across a selection change instead of remounting it, so the panel
    // kept showing the *previous* block's Mix/Level (and every other
    // param) no matter which block was actually selected - reported as
    // "changing Mix on one effect changes it for the other too".
    const delayBlock: BlockInstance = { id: 'delay-1', kind: 'delay', row: 0, col: 0, params: {} }
    const reverbBlock: BlockInstance = {
      id: 'reverb-1',
      kind: 'reverb',
      row: 0,
      col: 1,
      params: {},
    }
    useGraphStore.getState().loadGraph([delayBlock, reverbBlock], [], 1, false)

    const blocksById: Record<string, Block> = {
      'delay-1': fakeEffectBlock('delay', {
        mix: 0.3,
        level: 0.7,
        time: 0.35,
        feedback: 0.35,
        tone: 12000,
      }),
      'reverb-1': fakeEffectBlock('reverb', { mix: 0.9, level: 0.4, roomSize: 0.84, damping: 0.5 }),
    }
    const rig = {
      getBlock: (id: string) => blocksById[id] ?? null,
      getBlockAnalyser: () => null,
    } as unknown as GraphRig

    const { rerender } = render(<BlockInspector rig={rig} context={null} />)

    useSelection.getState().select('delay-1')
    rerender(<BlockInspector rig={rig} context={null} />)
    expect(screen.getByRole('slider', { name: 'Mix' })).toHaveAttribute('aria-valuenow', '0.3')

    useSelection.getState().select('reverb-1')
    rerender(<BlockInspector rig={rig} context={null} />)
    expect(screen.getByRole('slider', { name: 'Mix' })).toHaveAttribute('aria-valuenow', '0.9')
  })
})
