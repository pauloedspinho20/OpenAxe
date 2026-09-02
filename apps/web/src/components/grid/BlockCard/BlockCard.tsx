import { memo, useRef, useState } from 'react'
import { BlockIcon, toast } from '@openaxe/ui'
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
import { BLOCK_KIND_LABELS } from '../blockOptions'
import { DotsHorizontalIcon } from '@openaxe/ui'
import { blockColorVar } from '../blockColors'
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
  /** Armed jack id for mobile two-tap connection (pulse). */
  armedJackId?: string | null
  /** Open the mobile action sheet (⋯) for this block. */
  onOpenMenu?: () => void
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
  // A send routes implicitly into its return, so it draws no output jack.
  // Every other kind has exactly one - the splitter was the only multi-output
  // kind and it is gone.
  if (kind === 'send-1' || kind === 'send-2') return 0
  return 1
}

/** Anything with an optional bypass toggle - the 11 effect kinds and the 5 NAM model kinds have one. */
interface MaybeBypassable {
  setBypass?(bypassed: boolean): void
}

/**
 * A grid cell's basic identity card: kind, quick bypass/remove, jacks, and a
 * one-line status for Amp/Cab (loaded asset name). Full parameters and the
 * asset load/browse controls live in BlockInspector instead - click the card
 * to select it there, rather than crowding every detail into a small tile.
 */
function BlockCardImpl({ instance, rig, onDragChange, armedJackId, onOpenMenu }: BlockCardProps) {
  const dragState = useRef<{ startX: number; startY: number } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)
  const edges = useGraphStore((s) => s.edges)

  // Re-render once async block creation inside bindGraphRig's reconcile
  // finishes - graphStore's own state doesn't change when that happens, so
  // nothing else would trigger this component to look again.
  useEngineVersion((s) => s.version)
  const block = rig?.getBlock(instance.id) ?? null
  const isEffect = EFFECT_KINDS.has(instance.kind)
  const hasBypass = isEffect || NAM_MODEL_KINDS.has(instance.kind)
  const label = BLOCK_KIND_LABELS[instance.kind]
  const isSelected = selectedBlockId === instance.id

  const handleCardPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-jack-id], button, input, select')) return
    // Long-press for mobile action sheet (500ms) — also accessible via ⋯ button.
    longPressFired.current = false
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      if (onOpenMenu) onOpenMenu()
      else useSelection.getState().select(instance.id)
      dragState.current = null
      setDragOffset(null)
      onDragChange?.(null)
    }, 500)
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
    // Cancel long-press if pointer moved
    if (longPressTimer.current) {
      const dx = e.clientX - dragState.current.startX
      const dy = e.clientY - dragState.current.startY
      if (Math.hypot(dx, dy) > 8) {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
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
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (longPressFired.current) {
      longPressFired.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      dragState.current = null
      setDragOffset(null)
      onDragChange?.(null)
      return
    }
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
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''} ${bypassed ? styles.bypassed : ''}`}
      style={
        {
          ...(dragOffset
            ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, zIndex: 10 }
            : {}),
          ...(dragState.current === null
            ? {}
            : { boxShadow: 'var(--shadow-panel)', transition: 'box-shadow 0.3s ease-in-out' }),
          '--block-color': blockColorVar(instance.kind),
        } as React.CSSProperties
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
        <div className={styles.headerActions}>
          <button
            type="button"
            disabled={!hasBypass}
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

          {/*     {analyser && (
            <div className={styles.meterWrap}>
              <LiveMeter analyser={analyser} variant="mini" label={`${label} level`} />
            </div>
          )} */}

          <button
            type="button"
            className={styles.menuBtn}
            onClick={(e) => {
              e.stopPropagation()
              if (onOpenMenu) onOpenMenu()
              else useSelection.getState().select(instance.id)
            }}
            aria-label={`Actions for ${label}`}
            title="More actions — move, remove, disconnect"
          >
            <DotsHorizontalIcon />
          </button>
        </div>
      </div>

      <div className={styles.blockIconWrapper}>
        <BlockIcon kind={instance.kind} size={32} className={styles.blockIcon} />
      </div>

      <span className={styles.blockLabel}>{label}</span>

      <div className={styles.meterWrap}></div>

      <div className={styles.jacks}>
        <div className={styles.jacksIn}>
          {Array.from({ length: portCount(instance.kind) }, (_, port) => {
            const occupied = edges.some((e) => e.to.blockId === instance.id && e.to.port === port)
            const jackId = jackElementId(instance.id, 'in', port)
            const armed = armedJackId === jackId
            return (
              <span key={port} className={styles.jackWrap}>
                <div
                  className={`${styles.jack} ${armed ? styles.jackArmed : ''}`}
                  data-jack-id={jackId}
                  data-jack-side="in"
                  title={
                    occupied
                      ? 'Tap to rewire (or drag) — or click badge to disconnect'
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
          {Array.from({ length: outputPortCount(instance.kind) }, (_, port) => {
            const jackId = jackElementId(instance.id, 'out', port)
            const armed = armedJackId === jackId
            return (
              <span key={port} className={styles.jackWrap}>
                <div
                  className={`${styles.jack} ${armed ? styles.jackArmed : ''}`}
                  data-jack-id={jackId}
                  data-jack-side="out"
                  title="Output — tap then tap input, or drag"
                />
              </span>
            )
          })}
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
