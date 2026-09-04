// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __clearPresetSelectionMemoryForTests,
  applyPresetSelection,
  firstBlockFromInput,
  resolvePresetSelection,
  useSelection,
} from './selection'
import { useCurrentPresetStore } from './currentPresetStore'

const b = (id: string, row: number, col: number) => ({ id, row, col })
const e = (from: string, to: string) => ({
  from: { blockId: from },
  to: { blockId: to },
})

describe('preset selection', () => {
  beforeEach(() => {
    useSelection.setState({ selectedBlockId: null })
    useCurrentPresetStore.setState({ saved: null })
    __clearPresetSelectionMemoryForTests()
  })

  it('firstBlockFromInput picks the block fed by the IN rail', () => {
    expect(
      firstBlockFromInput(
        [b('a', 0, 0), b('c', 0, 2)],
        [e('IN', 'c'), e('c', 'OUT'), e('IN', 'a')],
      ),
    ).toBe('a')
  })

  it('firstBlockFromInput falls back to the leftmost block without an IN cable', () => {
    expect(firstBlockFromInput([b('x', 1, 3), b('y', 0, 1)], [])).toBe('y')
  })

  it('firstBlockFromInput returns null for an empty graph', () => {
    expect(firstBlockFromInput([], [])).toBeNull()
  })

  it('applyPresetSelection defaults to the input-first block on a fresh open', () => {
    applyPresetSelection('p1', [b('a', 0, 0), b('c', 0, 2)], [e('IN', 'a'), e('a', 'c')])
    expect(useSelection.getState().selectedBlockId).toBe('a')
  })

  it('applyPresetSelection clears the selection for an empty preset', () => {
    useSelection.setState({ selectedBlockId: 'stale' })
    applyPresetSelection('p1', [], [])
    expect(useSelection.getState().selectedBlockId).toBeNull()
  })

  it('remembers the last explicit pick per preset and restores it on reopen', () => {
    useCurrentPresetStore.setState({
      saved: {
        id: 'p1',
        name: 'P',
        tags: [],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
        blocks: [],
        edges: [],
        masterLevel: 1,
        masterMuted: false,
      },
    })
    applyPresetSelection('p1', [b('a', 0, 0), b('c', 0, 2)], [e('IN', 'a'), e('a', 'c')])
    expect(useSelection.getState().selectedBlockId).toBe('a')

    // Explicit user pick is remembered.
    useSelection.getState().select('c')
    applyPresetSelection('p1', [b('a', 0, 0), b('c', 0, 2)], [e('IN', 'a'), e('a', 'c')])
    expect(useSelection.getState().selectedBlockId).toBe('c')
  })

  it('falls back to the default when the remembered block no longer exists', () => {
    useCurrentPresetStore.setState({
      saved: {
        id: 'p1',
        name: 'P',
        tags: [],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
        blocks: [],
        edges: [],
        masterLevel: 1,
        masterMuted: false,
      },
    })
    useSelection.getState().select('gone')
    expect(resolvePresetSelection('p1', [b('a', 0, 0)], [e('IN', 'a')])).toBe('a')
  })

  it('remembers independently per preset', () => {
    useCurrentPresetStore.setState({
      saved: {
        id: 'p1',
        name: 'P',
        tags: [],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
        blocks: [],
        edges: [],
        masterLevel: 1,
        masterMuted: false,
      },
    })
    useSelection.getState().select('a1')
    useCurrentPresetStore.setState({
      saved: {
        id: 'p2',
        name: 'Q',
        tags: [],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
        blocks: [],
        edges: [],
        masterLevel: 1,
        masterMuted: false,
      },
    })
    useSelection.getState().select('b9')
    expect(resolvePresetSelection('p1', [b('a1', 0, 0)], [e('IN', 'a1')])).toBe('a1')
    expect(resolvePresetSelection('p2', [b('b9', 0, 5)], [e('IN', 'b9')])).toBe('b9')
  })
})
