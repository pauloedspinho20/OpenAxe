import { beforeEach, describe, expect, it } from 'vitest'
import { syncTempoToBlocks } from './useTempoSync'
import { useGraphStore } from '../state/graphStore'
import { useTempoStore } from '../state/tempoStore'

describe('syncTempoToBlocks', () => {
  beforeEach(() => {
    useTempoStore.setState({ bpm: 120 })
    useGraphStore.setState({
      blocks: [
        { id: 'd', kind: 'delay', row: 0, col: 0, params: { tempoSync: '1/4', time: 300 } },
        { id: 'f', kind: 'delay', row: 0, col: 1, params: { tempoSync: 'off', time: 300 } },
      ],
      edges: [],
    } as never)
  })

  it('writes only synced blocks and follows bpm changes', () => {
    syncTempoToBlocks()
    const get = (id: string) => useGraphStore.getState().blocks.find((b) => b.id === id)!.params
    expect(get('d').time).toBe(500)
    expect(get('f').time).toBe(300)
    useTempoStore.setState({ bpm: 60 })
    syncTempoToBlocks()
    expect(get('d').time).toBe(1000)
  })
})
