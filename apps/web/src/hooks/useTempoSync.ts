import { useEffect } from 'react'
import { tempoSyncedParams } from '../effects/tempoSync'
import { useGraphStore } from '../state/graphStore'
import { useTempoStore } from '../state/tempoStore'

/** Push the global BPM into every tempo-synced block's time/rate param. */
export function syncTempoToBlocks(): void {
  const bpm = useTempoStore.getState().bpm
  const { blocks, setBlockParams } = useGraphStore.getState()
  for (const block of blocks) {
    const write = tempoSyncedParams(block.kind, block.params, bpm)
    if (write) setBlockParams(block.id, write)
  }
}

/**
 * Mount once (App): re-syncs whenever the BPM changes or any block's params or
 * the block set change (a division was picked, a preset loaded). Idempotent -
 * tempoSyncedParams returns null once a block already holds the value - so the
 * store write it causes does not loop.
 */
export function useTempoSync(): void {
  useEffect(() => {
    syncTempoToBlocks()
    const offTempo = useTempoStore.subscribe((s, prev) => {
      if (s.bpm !== prev.bpm) syncTempoToBlocks()
    })
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.blocks !== prev.blocks) syncTempoToBlocks()
    })
    return () => {
      offTempo()
      offGraph()
    }
  }, [])
}
