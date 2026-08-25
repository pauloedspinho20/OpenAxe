import { create } from 'zustand'
import { UndoStack } from './undoStack'
import { useGraphStore } from './graphStore'
import { applyPreset } from '../presets/apply'
import type { Preset, PresetBlockData, PresetEdgeData, PresetRig } from '../presets/types'
import type { PresetBlock } from '../presets/types'

export interface GraphSnapshot {
  blocks: PresetBlockData[]
  edges: PresetEdgeData[]
  masterLevel: number
  masterMuted: boolean
}

export interface HistoryTarget {
  rig: PresetRig
  context: AudioContext
}

const HISTORY_DEBOUNCE_MS = 300
const HISTORY_MAX = 50

let target: HistoryTarget | null = null
let isRestoring = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingSnapshot: GraphSnapshot | null = null

function getSnapshotFromGraph(): GraphSnapshot {
  const g = useGraphStore.getState()
  const rig = target?.rig ?? null
  return {
    blocks: g.blocks.map((b) => {
      if (!rig) {
        return {
          id: b.id,
          kind: b.kind,
          row: b.row,
          col: b.col,
          ...(b.bypass !== undefined ? { bypass: b.bypass } : {}),
          params: { ...b.params },
          modelId: null,
          modelName: null,
          irId: null,
          irName: null,
        } satisfies PresetBlockData
      }
      const block = rig.getBlock(b.id) as PresetBlock | null
      const model = block?.getLoadedModel?.() ?? null
      const ir = block?.getLoadedIr?.() ?? null
      return {
        id: b.id,
        kind: b.kind,
        row: b.row,
        col: b.col,
        ...(b.bypass !== undefined ? { bypass: b.bypass } : {}),
        params: { ...b.params },
        modelId: model?.id ?? null,
        modelName: model?.name ?? null,
        irId: ir?.id ?? null,
        irName: ir?.name ?? null,
      } satisfies PresetBlockData
    }),
    edges: g.edges.map((e) => ({ id: e.id, from: { ...e.from }, to: { ...e.to } })),
    masterLevel: g.masterLevel,
    masterMuted: g.masterMuted,
  }
}

function snapshotsEqual(a: GraphSnapshot, b: GraphSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isParamOnlyChange(prev: GraphSnapshot, next: GraphSnapshot): boolean {
  if (prev.blocks.length !== next.blocks.length) return false
  if (prev.edges.length !== next.edges.length) return false
  if (prev.masterLevel !== next.masterLevel) return false
  if (prev.masterMuted !== next.masterMuted) return false
  const prevById = new Map(prev.blocks.map((b) => [b.id, b] as const))
  for (const nb of next.blocks) {
    const pb = prevById.get(nb.id)
    if (!pb) return false
    if (pb.kind !== nb.kind || pb.row !== nb.row || pb.col !== nb.col) return false
    if (pb.bypass !== nb.bypass) return false
    if (pb.modelId !== nb.modelId || pb.irId !== nb.irId) return false
    if (pb.modelName !== nb.modelName || pb.irName !== nb.irName) return false
  }
  // edges topology — compare sorted keys (ids may be stable but compare endpoints)
  const key = (e: PresetEdgeData) =>
    `${e.id}:${e.from.blockId}:${e.from.port}->${e.to.blockId}:${e.to.port}`
  const prevKeys = [...prev.edges].map(key).sort().join('|')
  const nextKeys = [...next.edges].map(key).sort().join('|')
  if (prevKeys !== nextKeys) return false
  return true
}

function createInitialStack(): UndoStack<GraphSnapshot> {
  return new UndoStack<GraphSnapshot>(getSnapshotFromGraph(), HISTORY_MAX)
}

let stack: UndoStack<GraphSnapshot> = createInitialStack()
let unsubscribeGraph: (() => void) | null = null

function notify(): void {
  useHistoryStore.setState({ canUndo: stack.canUndo(), canRedo: stack.canRedo() })
}

function flushPending(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (pendingSnapshot) {
    const toPush = pendingSnapshot
    pendingSnapshot = null
    // avoid pushing duplicate
    if (!snapshotsEqual(stack.value, toPush)) {
      stack.push(toPush)
      notify()
    }
  }
}

function schedulePush(next: GraphSnapshot): void {
  if (snapshotsEqual(stack.value, next) && !pendingSnapshot) return
  // also check pending equality
  if (pendingSnapshot && snapshotsEqual(pendingSnapshot, next)) return

  const base = pendingSnapshot ?? stack.value
  const paramOnly = isParamOnlyChange(base, next)

  if (paramOnly) {
    pendingSnapshot = next
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      const toPush = pendingSnapshot
      pendingSnapshot = null
      if (toPush && !snapshotsEqual(stack.value, toPush)) {
        stack.push(toPush)
        notify()
      }
    }, HISTORY_DEBOUNCE_MS)
  } else {
    // flush any pending param change first so we don't lose it
    if (pendingSnapshot) {
      const toPush = pendingSnapshot
      pendingSnapshot = null
      if (toPush && !snapshotsEqual(stack.value, toPush)) {
        stack.push(toPush)
      }
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (!snapshotsEqual(stack.value, next)) {
      stack.push(next)
      notify()
    }
  }
}

function ensureSubscription(): void {
  if (unsubscribeGraph) return
  unsubscribeGraph = useGraphStore.subscribe((state) => {
    if (isRestoring) return
    // Build snapshot from the new state — need to use the subscribe payload directly
    // to avoid reading stale model refs through getSnapshotFromGraph's rig path?
    // For correctness we capture via getSnapshotFromGraph which reads current graphStore + rig.
    // The `state` arg already reflects the new graphStore; getSnapshotFromGraph will see it.
    void state
    const next = getSnapshotFromGraph()
    schedulePush(next)
  })
}

ensureSubscription()

export function setHistoryTarget(next: HistoryTarget | null): void {
  target = next
}

export function getHistoryTarget(): HistoryTarget | null {
  return target
}

export function getHistoryStack(): UndoStack<GraphSnapshot> {
  return stack
}

/** Test helper — reset stack to current graph snapshot, clear debounce, notify. */
export function resetHistoryForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingSnapshot = null
  isRestoring = false
  stack = createInitialStack()
  notify()
}

export function flushHistoryForTests(): void {
  flushPending()
}

async function restoreSnapshot(snapshot: GraphSnapshot): Promise<void> {
  const t = target
  if (!t) {
    useGraphStore.getState().loadGraph(
      snapshot.blocks.map((b) => ({
        id: b.id,
        kind: b.kind,
        row: b.row,
        col: b.col,
        ...(b.bypass !== undefined ? { bypass: b.bypass } : {}),
        params: { ...b.params },
      })),
      snapshot.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
      snapshot.masterLevel,
      snapshot.masterMuted,
    )
    return
  }
  const preset: Preset = {
    id: 'history-snapshot',
    name: 'History',
    tags: [],
    favorite: false,
    createdAt: 0,
    updatedAt: 0,
    blocks: snapshot.blocks,
    edges: snapshot.edges,
    masterLevel: snapshot.masterLevel,
    masterMuted: snapshot.masterMuted,
  }
  await applyPreset(t.context, preset, t.rig, useGraphStore)
}

interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undo: () => Promise<void>
  redo: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  canUndo: stack.canUndo(),
  canRedo: stack.canRedo(),
  undo: async () => {
    flushPending()
    const prev = stack.undo()
    if (!prev) return
    isRestoring = true
    try {
      await restoreSnapshot(prev)
    } finally {
      isRestoring = false
      set({ canUndo: stack.canUndo(), canRedo: stack.canRedo() })
    }
    void get
  },
  redo: async () => {
    flushPending()
    const nxt = stack.redo()
    if (!nxt) return
    isRestoring = true
    try {
      await restoreSnapshot(nxt)
    } finally {
      isRestoring = false
      set({ canUndo: stack.canUndo(), canRedo: stack.canRedo() })
    }
  },
}))
