import { memo, useRef, useState } from 'react'
import { toast } from '@openaxe/ui'
import { useGraphStore, type BlockInstance } from '../../../state/graphStore'
import { useEngineVersion } from '../../../state/engineVersion'
import { useSelection } from '../../../state/selection'
import { canMoveTo } from '../../../engine/graphValidation'
import type { GraphRig } from '../../../engine/GraphRig'
import { GRID_ROWS, GRID_COLS, jack } from '../../../engine/gridConfig'
import { resolveGridCell } from '../gridGeometry'
import type { BlockKind } from '../../../engine/blocks/Block'
import { EFFECT_KINDS, NAM_MODEL_KINDS } from '../../../engine/blocks/blockRegistry'
import { MIXER_INPUT_COUNT } from '@/engine/blocks/MixerBlock'
import { SPLITTER_OUTPUT_COUNT } from '@/engine/blocks/SplitterBlock'
import { useTone3000Library } from '@/tone3000/library'
import { LiveMeter } from '@/components/global/LiveMeter/LiveMeter'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import { JackDisconnect } from '../JackDisconnect/JackDisconnect'
import { jackElementId } from '../jackId'
import styles from './BlockCard.module.css'

export interface BlockCardProps {
  instance: BlockInstance
  rig: GraphRig | null
  /**
   * Reports the dragged card's live state up to GridEditor: the cell under
   * the pointer, the pixel offset (so cables can follow the card), and
   * whether dropping there is a valid move. Null once the drag ends.
   */
  onDragChange?: (info: BlockDragInfo | null) => void
}

export interface BlockDragInfo {
  id: string
  cell: { row: number; col: number } | null
  offset: { x: number; y: number }
  valid: boolean
}

/** A click barely moves the pointer; anything past this is a drag, not a select. */
const CLICK_VS_DRAG_THRESHOLD_PX = 4

/** Input jacks to draw. Send/Return relays (issue #274) show a single side: Send has an input jack (its output is the implicit hop to its Return), Return has an output jack only. */
function portCount(kind: BlockKind): number {
  if (kind === 'return-1' || kind === 'return-2') return 0
  return kind === 'mixer' ? MIXER_INPUT_COUNT : 1
}

function outputPortCount(kind: BlockKind): number {
  if (kind === 'send-1' || kind === 'send-2') return 0
  return kind === 'splitter' ? SPLITTER_OUTPUT_COUNT : 1
}

/** Anything with an optional bypass toggle - the 11 effect kinds and the 5 NAM model kinds have one. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

/** Anything with optional loaded-asset getters - only NAM-model/Cab blocks have these. */
interface MaybeAsset {
  getLoadedModel?(): { id: string; name: string } | null
  getLoadedIr?(): { id: string; name: string } | null
}

function loadedAsset(
  instance: BlockInstance,
  block: MaybeAsset | null,
): { id: string; name: string } | null {
  if (NAM_MODEL_KINDS.has(instance.kind)) return block?.getLoadedModel?.() ?? null
  if (instance.kind === 'cab') return block?.getLoadedIr?.() ?? null
  return null
}

function statusText(instance: BlockInstance, loaded: { name: string } | null): string | null {
  if (NAM_MODEL_KINDS.has(instance.kind)) return loaded?.name ?? 'No model'
  if (instance.kind === 'cab') return loaded?.name ?? 'No IR'
  return null
}

/**
 * A grid cell's basic identity card: kind, quick bypass/remove, jacks, and a
 * one-line status for Amp/Cab (loaded asset name). Full parameters and the
 * asset load/browse controls live in BlockInspector instead - click the card
 * to select it there, rather than crowding every detail into a small tile.
 */
function BlockCardImpl({ instance, rig, onDragChange }: BlockCardProps) {
  const dragState = useRef<{ startX: number; startY: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)
  const edges = useGraphStore((s) => s.edges)

  // Re-render once async block creation inside bindGraphRig's reconcile
  // finishes - graphStore's own state doesn't change when that happens, so
  // nothing else would trigger this component to look again.
  useEngineVersion((s) => s.version)
  const libraryEntries = useTone3000Library((s) => s.entries)
  const block = rig?.getBlock(instance.id) ?? null
  const isEffect = EFFECT_KINDS.has(instance.kind)
  const hasBypass = isEffect || NAM_MODEL_KINDS.has(instance.kind)
  const label = BLOCK_KIND_LABELS[instance.kind]
  const loaded = loadedAsset(instance, block as MaybeAsset | null)
  const status = statusText(instance, loaded)
  const cardImageUrl = loaded
    ? (libraryEntries.find((e) => e.id === loaded.id)?.imageUrl ?? null)
    : null
  const analyser = rig?.getBlockAnalyser(instance.id) ?? null
  const isSelected = selectedBlockId === instance.id

  const handleCardPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-jack-id], button, input, select')) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // The pointer isn't tracked as active (e.g. a synthetic event) - the
      // drag still works via direct pointermove/pointerup on this element,
      // it just won't keep tracking if the pointer leaves its bounds.
    }
    dragState.current = { startX: e.clientX, startY: e.clientY }
    setDragOffset({ x: 0, y: 0 })
    onDragChange?.({ id: instance.id, cell: null, offset: { x: 0, y: 0 }, valid: false })
  }

  const handleCardPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    const offset = {
      x: e.clientX - dragState.current.startX,
      y: e.clientY - dragState.current.startY,
    }
    setDragOffset(offset)
    const gridEl = (e.currentTarget as Element).closest('[data-grid-bounds]') as HTMLElement | null
    const cell = gridEl ? resolveGridCell(gridEl, e.clientX, e.clientY) : null
    if (!cell) {
      onDragChange?.({ id: instance.id, offset, valid: false, cell })
      return
    }
    const valid = canMoveTo(
      new Map(
        useGraphStore
          .getState()
          .blocks.map((b) => [b.id, { id: b.id, kind: b.kind, col: b.col }] as const),
      ),
      edges,
      instance.id,
      cell.col,
    ).ok
    onDragChange?.({ id: instance.id, cell, offset, valid })
  }

  const handleCardPointerUp = (e: React.PointerEvent) => {
    if (!dragState.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Nothing to release - fine.
    }
    const { startX, startY } = dragState.current
    const distance = Math.hypot(e.clientX - startX, e.clientY - startY)

    if (distance <= CLICK_VS_DRAG_THRESHOLD_PX) {
      useSelection.getState().select(instance.id)
    } else {
      const gridEl = (e.currentTarget as Element).closest(
        '[data-grid-bounds]',
      ) as HTMLElement | null
      if (gridEl) {
        const { row, col } = resolveGridCell(gridEl, e.clientX, e.clientY)
        const store = useGraphStore.getState()
        const occupied = store.blocks.some(
          (b) => b.id !== instance.id && b.row === row && b.col === col,
        )
        if (!occupied && (row !== instance.row || col !== instance.col)) {
          const result = store.moveBlock(instance.id, row, col)
          if (!result.ok) {
            toast.error("Can't move there", { description: result.reason })
          }
        }
      }
    }

    onDragChange?.(null)
    dragState.current = null
    setDragOffset(null)
  }

  const bypassed = instance.bypass ?? false

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      useSelection.getState().select(instance.id)
      return
    }
    let row = instance.row
    let col = instance.col
    switch (e.key) {
      case 'ArrowUp':
        row -= 1
        break
      case 'ArrowDown':
        row += 1
        break
      case 'ArrowLeft':
        col -= 1
        break
      case 'ArrowRight':
        col += 1
        break
      default:
        return
    }
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return
    e.preventDefault()
    const store = useGraphStore.getState()
    if (store.blocks.some((b) => b.id !== instance.id && b.row === row && b.col === col)) return
    const result = store.moveBlock(instance.id, row, col)
    if (!result.ok) {
      toast.error("Can't move there", { description: result.reason })
    }
  }

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''} ${cardImageUrl ? styles.cardWithImage : ''}`}
      style={{
        ...(cardImageUrl ? { backgroundImage: `url(${cardImageUrl})` } : {}),
        ...(dragOffset
          ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, zIndex: 10 }
          : {}),
      }}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`${label} block - click or Enter to edit, arrow keys to move`}
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={handleCardPointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.header}>
        <div className={styles.headerActions}>
          {hasBypass && (
            <button
              type="button"
              className={`${styles.bypassBtn} ${bypassed ? '' : styles.bypassBtnOn}`}
              onClick={() => {
                useGraphStore.getState().setBlockBypass(instance.id, !bypassed)
                ;(block as MaybeBypassable | null)?.setBypass?.(!bypassed)
              }}
              title={bypassed ? 'Bypassed - click to enable' : 'Click to bypass'}
              aria-label={bypassed ? `Enable ${label}` : `Bypass ${label}`}
            >
              ●
            </button>
          )}
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => useGraphStore.getState().removeBlock(instance.id)}
            aria-label={`Remove ${label}`}
          >
            ×
          </button>
        </div>
      </div>

      <span className={`${styles.kindLabel} `}>
        {/*   <BlockIcon kind={instance.kind} size={18} className={styles.kindIcon} /> */}
        <span className={styles.blockLabel}>{label}</span>
        {status && <span className={styles.status}>{status}</span>}
      </span>

      <div className={styles.meterWrap}>
        {analyser && <LiveMeter analyser={analyser} variant="mini" label={`${label} level`} />}
      </div>

      <div className={styles.jacks}>
        <div className={styles.jacksIn}>
          {Array.from({ length: portCount(instance.kind) }, (_, port) => {
            const occupied = edges.some((e) => e.to.blockId === instance.id && e.to.port === port)
            return (
              <span key={port} className={styles.jackWrap}>
                <div
                  className={styles.jack}
                  data-jack-id={jackElementId(instance.id, 'in', port)}
                  data-jack-side="in"
                  title={
                    occupied
                      ? 'Drag to rewire this cable, or click the badge on it to disconnect'
                      : instance.kind === 'mixer'
                        ? `Input ${port + 1}`
                        : 'Input'
                  }
                />
                {occupied && (
                  <JackDisconnect
                    label={`Disconnect input ${port + 1}`}
                    onDisconnect={() =>
                      useGraphStore.getState().disconnectConnections(jack(instance.id, port), 'in')
                    }
                  />
                )}
              </span>
            )
          })}
        </div>
        <div className={styles.jacksOut}>
          {Array.from({ length: outputPortCount(instance.kind) }, (_, port) => (
            <span key={port} className={styles.jackWrap}>
              <div
                className={styles.jack}
                data-jack-id={jackElementId(instance.id, 'out', port)}
                data-jack-side="out"
                title={
                  instance.kind === 'splitter'
                    ? `Output ${port + 1} - drag from here to connect, or drag any of its cables`
                    : 'Output - drag from here to connect, or drag any of its cables'
                }
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Memoized so a param change elsewhere in the rig (which replaces only the
 * edited block's object in the store array, leaving the others' references
 * intact) doesn't re-render every card. Cards re-render only when their own
 * `instance`, the live `rig`, or the drag callback identity changes.
 */
export const BlockCard = memo(BlockCardImpl)
