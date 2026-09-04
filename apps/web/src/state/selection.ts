import { create } from 'zustand'
import { IN_RAIL } from '../engine/gridConfig'
import { useCurrentPresetStore } from './currentPresetStore'

interface SelectionState {
  selectedBlockId: string | null
  select: (id: string) => void
  clear: () => void
}

/**
 * Last explicitly-selected block per preset, in-session only (module-level
 * Map, never persisted). A cold start / power-on therefore always falls back
 * to the default — the first block fed by the input — while switching presets
 * mid-session restores whatever was last touched in each preset.
 */
const lastSelectedByPreset = new Map<string, string>()

export interface SelectableBlock {
  id: string
  row: number
  col: number
}

export interface SelectableEdge {
  from: { blockId: string }
  to: { blockId: string }
}

/**
 * The preset's default selection: the block directly fed by the IN rail
 * (leftmost-topmost when several fan out from it), else the leftmost-topmost
 * block. Null when the graph is empty.
 */
export function firstBlockFromInput(
  blocks: readonly SelectableBlock[],
  edges: readonly SelectableEdge[],
): string | null {
  if (blocks.length === 0) return null
  const fromInput = new Set(
    edges.filter((e) => e.from.blockId === IN_RAIL).map((e) => e.to.blockId),
  )
  const candidates = fromInput.size > 0 ? blocks.filter((b) => fromInput.has(b.id)) : [...blocks]
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.col - b.col || a.row - b.row || (a.id < b.id ? -1 : 1))
  return candidates[0]!.id
}

/**
 * Which block a preset open should select: the remembered last selection
 * when it still exists in this graph, else the input-first default.
 */
export function resolvePresetSelection(
  presetId: string,
  blocks: readonly SelectableBlock[],
  edges: readonly SelectableEdge[],
): string | null {
  const remembered = lastSelectedByPreset.get(presetId)
  if (remembered && blocks.some((b) => b.id === remembered)) return remembered
  return firstBlockFromInput(blocks, edges)
}

/**
 * Apply the open-preset selection rule (see resolvePresetSelection). Opening
 * a preset never writes the memory map — only an explicit user select does —
 * so a defaulted open can't clobber a remembered pick.
 */
export function applyPresetSelection(
  presetId: string,
  blocks: readonly SelectableBlock[],
  edges: readonly SelectableEdge[],
): void {
  const next = resolvePresetSelection(presetId, blocks, edges)
  useSelection.setState({ selectedBlockId: next })
}

/** Test-only: drop the whole per-preset memory map. */
export function __clearPresetSelectionMemoryForTests(): void {
  lastSelectedByPreset.clear()
}

/** Which block's full parameters/options are shown in the BlockInspector panel. */
export const useSelection = create<SelectionState>()((set) => ({
  selectedBlockId: null,
  select: (id) => {
    set({ selectedBlockId: id })
    // Remember explicit user picks per preset so revisiting the preset
    // restores them; default selections from preset opens bypass this.
    const presetId = useCurrentPresetStore.getState().saved?.id
    if (presetId) lastSelectedByPreset.set(presetId, id)
  },
  clear: () => set({ selectedBlockId: null }),
}))
