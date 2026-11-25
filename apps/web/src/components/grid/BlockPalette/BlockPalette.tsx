import { useRef, useState } from 'react'
import { BlockIcon, toast } from '@openaxe/ui'
import type { BlockKind } from '../../../engine/blocks/Block'
import { useGraphStore } from '../../../state/graphStore'
import { BLOCK_OPTIONS, BLOCK_KIND_LABELS } from '../blockOptions'
import { findGridElement, isPointOverGrid, resolveGridCell } from '../gridGeometry'
import { blockColorVar } from '../blockColors'
import { TunerDialog } from '../TunerDialog/TunerDialog'
import { openCatalogForNewBlock } from '../openCatalogForNewBlock'
import { BlockChip } from './BlockChip'
import styles from './BlockPalette.module.css'

const SEND_RETURN_KINDS = new Set<BlockKind>(['send-1', 'send-2', 'return-1', 'return-2'])

function canPlaceKindAt(kind: BlockKind, row: number, col: number): boolean {
  const { blocks } = useGraphStore.getState()
  if (blocks.some((b) => b.row === row && b.col === col)) return false
  if (SEND_RETURN_KINDS.has(kind) && blocks.some((b) => b.kind === kind)) return false
  return true
}

function measureGridCellSize(gridEl: HTMLElement | null): number {
  const width = gridEl?.firstElementChild?.getBoundingClientRect().width ?? 0
  return width > 0 ? Math.round(width) : 80
}

interface DragState {
  kind: BlockKind
  label: string
  x: number
  y: number
  overGrid: boolean
  valid: boolean
  targetSize: number
  chipScale: number
}

export interface PaletteDragInfo {
  kind: BlockKind
  cell: { row: number; col: number } | null
  valid: boolean
}

export interface BlockPaletteProps {
  tunerAnalyser: AnalyserNode | null
  onDragChange?: ((info: PaletteDragInfo | null) => void) | undefined
}

/**
 * A persistent shelf of every placeable block kind below the grid. Each chip
 * mirrors the BlockCard hardware tile at compact scale and expands to match the
 * target grid cell size while dragging onto the grid.
 */
export function BlockPalette({ tunerAnalyser, onDragChange }: BlockPaletteProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [tunerOpen, setTunerOpen] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  const clearDrag = (el: EventTarget & Element, pointerId: number) => {
    try {
      el.releasePointerCapture(pointerId)
    } catch {
      // Nothing to release - fine.
    }
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    onDragChange?.(null)
    return current
  }

  const handlePointerDown = (
    e: React.PointerEvent,
    kind: BlockKind,
    label: string,
    disabled?: boolean,
  ) => {
    if (disabled) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic/inactive pointer - the drag still works via clientX/clientY tracking below.
    }
    const chipWidth = e.currentTarget.getBoundingClientRect().width || 54
    const targetSize = measureGridCellSize(findGridElement())
    const chipScale = Math.min(1, Math.max(0.55, chipWidth / targetSize))
    const next: DragState = {
      kind,
      label,
      x: e.clientX,
      y: e.clientY,
      overGrid: false,
      valid: true,
      targetSize,
      chipScale,
    }
    dragRef.current = next
    setDrag(next)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const gridEl = findGridElement()
    const overGrid = !!gridEl && isPointOverGrid(gridEl, e.clientX, e.clientY)
    const cell = overGrid && gridEl ? resolveGridCell(gridEl, e.clientX, e.clientY) : null
    const valid = cell ? canPlaceKindAt(dragRef.current.kind, cell.row, cell.col) : false
    const targetSize = measureGridCellSize(gridEl)
    const next: DragState = {
      ...dragRef.current,
      x: e.clientX,
      y: e.clientY,
      overGrid,
      valid,
      targetSize,
    }
    dragRef.current = next
    setDrag(next)
    onDragChange?.(cell ? { kind: dragRef.current.kind, cell, valid } : null)
  }

  const handlePointerCancel = (e: React.PointerEvent) => {
    clearDrag(e.currentTarget, e.pointerId)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const current = clearDrag(e.currentTarget, e.pointerId)
    if (!current) return

    const gridEl = findGridElement()
    if (!gridEl || !isPointOverGrid(gridEl, e.clientX, e.clientY)) return
    const { row, col } = resolveGridCell(gridEl, e.clientX, e.clientY)
    const store = useGraphStore.getState()
    if (store.blocks.some((b) => b.row === row && b.col === col)) return
    const id = store.addBlock(current.kind, row, col)
    if (id === null) {
      toast.warning(`${BLOCK_KIND_LABELS[current.kind]} is already on the grid`, {
        description: 'Send/Return blocks are strictly 1:1.',
      })
      return
    }
    openCatalogForNewBlock(id, current.kind)
  }

  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))
  const groupedOptions = groups.map((group) => ({
    group,
    items: BLOCK_OPTIONS.filter((o) => o.group === group),
  }))

  return (
    <div className={styles.paletteRow}>
      {groupedOptions.map(({ group, items }) => (
        <div
          key={group}
          className={styles.group}
          style={{ '--group-count': items.length } as React.CSSProperties}
        >
          <span className={`label ${styles.groupLabel}`}>{group}</span>
          <div className={styles.chips}>
            {items.map((option) => (
              <BlockChip
                key={option.kind}
                kind={option.kind}
                label={option.label}
                disabled={option.disabled}
                dragging={drag?.kind === option.kind}
                aria-label={
                  option.disabled
                    ? `${option.label} - not yet available (${option.vendor})`
                    : `Drag ${option.label} onto the grid`
                }
                title={option.disabled ? option.vendor : option.label}
                onPointerDown={(e) =>
                  handlePointerDown(e, option.kind, option.label, option.disabled)
                }
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              />
            ))}
          </div>
        </div>
      ))}

      {drag && (
        <div
          className={`${styles.ghost} ${drag.overGrid ? (drag.valid ? styles.ghostOverGrid : styles.ghostInvalid) : ''}`}
          style={
            {
              width: `${drag.targetSize}px`,
              height: `${drag.targetSize}px`,
              translate: `calc(${drag.x}px - 50%) calc(${drag.y}px - 50%)`,
              '--ghost-rest-scale': String(drag.chipScale),
              '--block-color': blockColorVar(drag.kind),
            } as React.CSSProperties
          }
        >
          <BlockIcon kind={drag.kind} size={32} className={styles.ghostIcon} />
          <span className={styles.ghostLabel}>{drag.label}</span>
        </div>
      )}

      <TunerDialog open={tunerOpen} onClose={() => setTunerOpen(false)} analyser={tunerAnalyser} />
    </div>
  )
}
