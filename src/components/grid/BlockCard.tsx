import { useRef, useState } from 'react'
import { useGraphStore, type BlockInstance } from '../../state/graphStore'
import { useEngineVersion } from '../../state/engineVersion'
import { useSelection } from '../../state/selection'
import { showToast } from '../../state/toast'
import type { GraphRig } from '../../engine/GraphRig'
import { GRID_ROWS, GRID_COLS } from '../../engine/gridConfig'
import { resolveGridCell } from './gridGeometry'
import type { BlockKind } from '../../engine/blocks/Block'
import { EFFECT_KINDS } from '../../engine/blocks/blockRegistry'
import { MIXER_INPUT_COUNT } from '../../engine/blocks/MixerBlock'
import { BLOCK_KIND_LABELS } from './blockOptions'
import { jackElementId } from './jackId'
import styles from './BlockCard.module.css'

export interface BlockCardProps {
  instance: BlockInstance
  rig: GraphRig | null
}

/** A click barely moves the pointer; anything past this is a drag, not a select. */
const CLICK_VS_DRAG_THRESHOLD_PX = 4

function portCount(kind: BlockKind): number {
  return kind === 'mixer' ? MIXER_INPUT_COUNT : 1
}

/** Anything with an optional bypass toggle - only the 11 effect kinds have one. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

/** Anything with optional loaded-asset getters - only Amp/Cab blocks have these. */
interface MaybeAsset {
  getLoadedModel?(): { name: string } | null
  getLoadedIr?(): { name: string } | null
}

function statusText(instance: BlockInstance, block: MaybeAsset | null): string | null {
  if (instance.kind === 'amp') return block?.getLoadedModel?.()?.name ?? 'No model'
  if (instance.kind === 'cab') return block?.getLoadedIr?.()?.name ?? 'No IR'
  return null
}

/**
 * A grid cell's basic identity card: kind, quick bypass/remove, jacks, and a
 * one-line status for Amp/Cab (loaded asset name). Full parameters and the
 * asset load/browse controls live in BlockInspector instead - click the card
 * to select it there, rather than crowding every detail into a small tile.
 */
export function BlockCard({ instance, rig }: BlockCardProps) {
  const dragState = useRef<{ startX: number; startY: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)

  // Re-render once async block creation inside bindGraphRig's reconcile
  // finishes - graphStore's own state doesn't change when that happens, so
  // nothing else would trigger this component to look again.
  useEngineVersion((s) => s.version)
  const block = rig?.getBlock(instance.id) ?? null
  const isEffect = EFFECT_KINDS.has(instance.kind)
  const label = BLOCK_KIND_LABELS[instance.kind]
  const status = statusText(instance, block as MaybeAsset | null)
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
  }

  const handleCardPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    setDragOffset({
      x: e.clientX - dragState.current.startX,
      y: e.clientY - dragState.current.startY,
    })
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
          const { droppedEdgeIds } = store.moveBlock(instance.id, row, col)
          if (droppedEdgeIds.length > 0) {
            showToast(
              droppedEdgeIds.length === 1
                ? 'Moving that block removed 1 connection that would have gone backward'
                : `Moving that block removed ${droppedEdgeIds.length} connections that would have gone backward`,
            )
          }
        }
      }
    }

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
    const { droppedEdgeIds } = store.moveBlock(instance.id, row, col)
    if (droppedEdgeIds.length > 0) {
      showToast(
        droppedEdgeIds.length === 1
          ? 'Moving that block removed 1 connection that would have gone backward'
          : `Moving that block removed ${droppedEdgeIds.length} connections that would have gone backward`,
      )
    }
  }

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
      style={
        dragOffset
          ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, zIndex: 10 }
          : undefined
      }
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
        <span className={`label ${styles.kindLabel}`}>{label}</span>
        <div className={styles.headerActions}>
          {isEffect && (
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

      <div className={styles.jacks}>
        <div className={styles.jacksIn}>
          {Array.from({ length: portCount(instance.kind) }, (_, port) => (
            <div
              key={port}
              className={styles.jack}
              data-jack-id={jackElementId(instance.id, 'in', port)}
              data-jack-side="in"
              title={instance.kind === 'mixer' ? `Input ${port + 1}` : 'Input'}
            />
          ))}
        </div>
        <div
          className={styles.jack}
          data-jack-id={jackElementId(instance.id, 'out', 0)}
          data-jack-side="out"
          title="Output"
        />
      </div>

      {status && <span className={styles.status}>{status}</span>}
    </div>
  )
}
