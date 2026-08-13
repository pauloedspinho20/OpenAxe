import { useRef, useState } from 'react'
import type { BlockKind } from '../../engine/blocks/Block'
import { useGraphStore } from '../../state/graphStore'
import { BLOCK_OPTIONS } from './blockOptions'
import { findGridElement, isPointOverGrid, resolveGridCell } from './gridGeometry'
import { BlockIcon } from './blockIcons'
import { Tuner } from '../Tuner'
import { TunerDialog } from './TunerDialog'
import { openCatalogForNewBlock } from './openCatalogForNewBlock'
import styles from './BlockPalette.module.css'

interface DragState {
  kind: BlockKind
  label: string
  x: number
  y: number
  overGrid: boolean
}

export interface BlockPaletteProps {
  tunerAnalyser: AnalyserNode | null
}

/**
 * A persistent shelf of every placeable block kind, above the grid. Drag a
 * chip onto an empty cell to place it there - the click-to-add popover on
 * empty cells (AddBlockMenu) still works too, this is just a second, more
 * direct path to the same `graphStore.addBlock` call. The tuner lives at the
 * left as its own non-draggable block section: a live mini readout that
 * expands into a full-size dialog (which mutes the app output) on click.
 */
export function BlockPalette({ tunerAnalyser }: BlockPaletteProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [tunerOpen, setTunerOpen] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  const handlePointerDown = (e: React.PointerEvent, kind: BlockKind, label: string) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic/inactive pointer - the drag still works via clientX/clientY tracking below.
    }
    const next: DragState = { kind, label, x: e.clientX, y: e.clientY, overGrid: false }
    dragRef.current = next
    setDrag(next)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const gridEl = findGridElement()
    const overGrid = !!gridEl && isPointOverGrid(gridEl, e.clientX, e.clientY)
    const next: DragState = { ...dragRef.current, x: e.clientX, y: e.clientY, overGrid }
    dragRef.current = next
    setDrag(next)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Nothing to release - fine.
    }
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!current) return

    const gridEl = findGridElement()
    if (!gridEl || !isPointOverGrid(gridEl, e.clientX, e.clientY)) return
    const { row, col } = resolveGridCell(gridEl, e.clientX, e.clientY)
    const store = useGraphStore.getState()
    if (store.blocks.some((b) => b.row === row && b.col === col)) return
    const id = store.addBlock(current.kind, row, col)
    openCatalogForNewBlock(id, current.kind)
  }

  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))

  return (
    <div className={styles.paletteRow}>
      <button
        type="button"
        className={styles.tunerSection}
        onClick={() => setTunerOpen(true)}
        aria-label="Open tuner"
        title="Open the full-size tuner (mutes output)"
      >
        <div className={styles.tunerLive}>
          <Tuner analyser={tunerAnalyser} />
        </div>
      </button>
      <div className={styles.shelf}>
        {groups.map((group) => (
          <div key={group} className={styles.group}>
            <span className={`label ${styles.groupLabel}`}>{group}</span>
            <div className={styles.chips}>
              {BLOCK_OPTIONS.filter((o) => o.group === group).map((option) => (
                <div
                  key={option.kind}
                  className={styles.chip}
                  role="button"
                  tabIndex={0}
                  aria-label={`Drag ${option.label} onto the grid`}
                  onPointerDown={(e) => handlePointerDown(e, option.kind, option.label)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  {/*   <BlockIcon kind={option.kind} size={20} /> */}
                  {option.label}
                </div>
              ))}
            </div>
          </div>
        ))}

        {drag && (
          <div
            className={`${styles.ghost} ${drag.overGrid ? styles.ghostOverGrid : ''}`}
            style={{ left: drag.x, top: drag.y }}
          >
            <BlockIcon kind={drag.kind} size={12} />
            {drag.label}
          </div>
        )}

        <TunerDialog
          open={tunerOpen}
          onClose={() => setTunerOpen(false)}
          analyser={tunerAnalyser}
        />
      </div>
    </div>
  )
}
