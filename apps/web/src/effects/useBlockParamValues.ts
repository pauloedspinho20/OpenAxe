import { useEffect, useState } from 'react'
import type { Block, EffectParams } from '@/engine/blocks/Block'
import { useGraphStore } from '@/state/graphStore'

/**
 * The displayed param values for one block, and the setter that writes them.
 *
 * Shared by EffectParamsPanel (the inspector strip) and EffectDetailsDialog
 * (the full dialog). Both render the same schema against the same block, and
 * both used to carry their own copy of this logic - which meant two live
 * `JSON.stringify`-keyed store subscriptions per selected block, since the
 * dialog is mounted whenever an effect block is selected rather than only
 * while it is open.
 *
 * Local state is the source of truth for what is displayed, updated
 * optimistically on every change, rather than re-reading `block.getParams()`
 * after each edit: the underlying AudioParams ramp via `setTargetAtTime`, so
 * reading `.value` straight back would show a stale, not-yet-settled number
 * and make the knobs visually stutter.
 *
 * Writes go through graphStore, never straight to the live block.
 * bindGraphRig re-applies every block's stored params on each reconcile pass,
 * so a knob writing directly to the engine would be reverted to the store's
 * stale copy by the very next unrelated store change (adding some other
 * block, say).
 */
export function useBlockParamValues(blockId: string | null, block: Block | null) {
  const [values, setValues] = useState<EffectParams>(() => ({
    ...(block?.getParams() ?? {}),
    ...(blockId
      ? useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params
      : undefined),
  }))

  // A stable JSON key, so store updates to *other* blocks don't retrigger the
  // sync. Keeps local values correct when the store changes from outside the
  // knob: undo, preset load, MIDI, automation.
  const storeParamsKey = useGraphStore((s) => {
    if (!blockId) return ''
    const p = s.blocks.find((b) => b.id === blockId)?.params
    return p ? JSON.stringify(p) : ''
  })

  useEffect(() => {
    if (!storeParamsKey) return
    const parsed = JSON.parse(storeParamsKey) as EffectParams
    setValues((prev) => ({ ...prev, ...parsed }))
    // storeParamsKey is the whole payload; parsing it inside keeps the dep list
    // to the one stable string.
  }, [storeParamsKey])

  // Switching blocks replaces the values outright rather than merging, so a
  // param the new block doesn't have can't linger from the previous one.
  useEffect(() => {
    const latest = blockId
      ? useGraphStore.getState().blocks.find((b) => b.id === blockId)?.params
      : undefined
    setValues({ ...(block?.getParams() ?? {}), ...(latest ?? {}) })
  }, [block, blockId])

  const setParam = (key: string, value: number | string) => {
    if (!blockId) return
    useGraphStore.getState().setBlockParams(blockId, { [key]: value })
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  return { values, setParam }
}
