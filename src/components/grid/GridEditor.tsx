import { useRef, useState } from 'react'
import { useGraphStore } from '../../state/graphStore'
import type { GraphRig } from '../../engine/GraphRig'
import { GRID_ROWS, GRID_COLS, IN_RAIL, OUT_RAIL, jack, jackKey } from '../../engine/gridConfig'
import type { BlockKind } from '../../engine/blocks/Block'
import { BlockCard } from './BlockCard'
import { BlockPalette } from './BlockPalette'
import { CableLayer, type DragPreview } from './CableLayer'
import { AddBlockMenu } from './AddBlockMenu'
import { JackDisconnect } from './JackDisconnect'
import { openCatalogForNewBlock } from './openCatalogForNewBlock'
import { jackElementId, parseJackElementId } from './jackId'
import styles from './GridEditor.module.css'

export interface GridEditorProps {
  rig: GraphRig | null
  /** Taps the raw input signal - rendered as a tuner right next to the IN rail. */
  tunerAnalyser: AnalyserNode | null
}

/**
 * The 3xGRID_COLS routing grid: a fixed IN rail, the grid of placeable
 * blocks, a fixed OUT rail, and a cable overlay - replaces the old fixed
 * dual-chain SignalFlow/ChannelStrip pair entirely. Owns all drag-to-connect
 * pointer handling (it's the nearest common ancestor of every jack, whether
 * that jack belongs to a rail or a BlockCard several levels down). Block
 * cards only show basic info - full parameters and asset loading live in
 * BlockInspector, which reads the selection this component sets on click.
 */
export function GridEditor({ rig, tunerAnalyser }: GridEditorProps) {
  const blocks = useGraphStore((s) => s.blocks)
  const edges = useGraphStore((s) => s.edges)
  const [addMenuCell, setAddMenuCell] = useState<{ row: number; col: number } | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const draggingJackRef = useRef<string | null>(null)

  const outHasCable = edges.some((e) => e.to.blockId === OUT_RAIL)

  /** Starts (or resumes) a connect-drag anchored at `fromJackId`, capturing the pointer on `el`. */
  const beginDrag = (el: HTMLElement, fromJackId: string, e: React.PointerEvent) => {
    e.preventDefault()
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // The pointer isn't tracked as active (e.g. a synthetic event) - the
      // drag still works via elementFromPoint on pointerup below.
    }
    draggingJackRef.current = fromJackId
    setDragPreview({ fromJackId, clientX: e.clientX, clientY: e.clientY })
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    const jackEl = (e.target as Element).closest('[data-jack-id]') as HTMLElement | null
    if (!jackEl) return
    const side = jackEl.dataset.jackSide

    if (side === 'out') {
      beginDrag(jackEl, jackEl.dataset.jackId!, e)
      return
    }

    // Picking up an already-wired input jack detaches its one cable and
    // re-anchors the drag at the cable's other (fixed) end, so dropping it
    // on a new input rewires the cable instead of requiring delete-then-redraw.
    if (side === 'in') {
      const { jack: toJack } = parseJackElementId(jackEl.dataset.jackId!)
      const existing = useGraphStore
        .getState()
        .edges.find((edge) => jackKey(edge.to) === jackKey(toJack))
      if (!existing) return
      useGraphStore.getState().disconnect(existing.id)
      beginDrag(jackEl, jackElementId(existing.from.blockId, 'out', existing.from.port), e)
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingJackRef.current) return
    setDragPreview((prev) => (prev ? { ...prev, clientX: e.clientX, clientY: e.clientY } : prev))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const fromJackId = draggingJackRef.current
    draggingJackRef.current = null
    setDragPreview(null)
    if (!fromJackId) return

    const targetEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-jack-id]') as HTMLElement | null
    if (!targetEl || targetEl.dataset.jackSide !== 'in') return

    const { jack: fromJack } = parseJackElementId(fromJackId)
    const { jack: toJack } = parseJackElementId(targetEl.dataset.jackId!)
    const result = useGraphStore.getState().connect(fromJack, toJack)
    if (!result.ok) {
      setRejectMessage(result.reason)
      window.setTimeout(() => setRejectMessage(null), 600)
    }
  }

  const cells = []
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const block = blocks.find((b) => b.row === row && b.col === col)
      cells.push(
        <div
          key={`${row}-${col}`}
          className={styles.cell}
          style={{ gridRow: row + 1, gridColumn: col + 1 }}
        >
          {block ? (
            <BlockCard instance={block} rig={rig} />
          ) : (
            <button
              type="button"
              className={styles.addCell}
              onClick={() => setAddMenuCell({ row, col })}
              aria-label={`Add a block at row ${row + 1}, column ${col + 1}`}
            >
              +
            </button>
          )}
        </div>,
      )
    }
  }

  return (
    <div className={styles.editor}>
      <BlockPalette tunerAnalyser={tunerAnalyser} />
      <div
        className={styles.wrap}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <CableLayer
          edges={edges}
          recomputeKey={blocks}
          dragPreview={dragPreview}
          rejectMessage={rejectMessage}
          onDisconnect={(edgeId) => useGraphStore.getState().disconnect(edgeId)}
        />

        <div className={styles.rail}>
          <span className={`label ${styles.railLabel}`}>IN</span>
          <span className={`${styles.railJackWrap} ${styles.railJackWrapRight}`}>
            <span
              className={styles.railJack}
              data-jack-id={jackElementId(IN_RAIL, 'out', 0)}
              data-jack-side="out"
              title="Output - drag from here to a block's input, or drag any of its cables"
            />
          </span>
        </div>

        <div className={styles.grid} data-grid-bounds>
          {cells}
        </div>

        <div className={styles.rail}>
          <span className={`${styles.railJackWrap} ${styles.railJackWrapLeft}`}>
            <span
              className={styles.railJack}
              data-jack-id={jackElementId(OUT_RAIL, 'in', 0)}
              data-jack-side="in"
              title={
                outHasCable
                  ? 'Drag to rewire this cable, or use the × on it to remove it'
                  : "Input - drag a block's output here"
              }
            />
            {outHasCable && (
              <JackDisconnect
                label="Disconnect output from the grid"
                onDisconnect={() =>
                  useGraphStore.getState().disconnectConnections(jack(OUT_RAIL, 0), 'in')
                }
              />
            )}
          </span>
          <span className={`label ${styles.railLabel}`}>OUT</span>
        </div>
      </div>

      {addMenuCell && (
        <AddBlockMenu
          onPick={(kind: BlockKind) => {
            const id = useGraphStore.getState().addBlock(kind, addMenuCell.row, addMenuCell.col)
            openCatalogForNewBlock(id, kind)
            setAddMenuCell(null)
          }}
          onClose={() => setAddMenuCell(null)}
        />
      )}
    </div>
  )
}
