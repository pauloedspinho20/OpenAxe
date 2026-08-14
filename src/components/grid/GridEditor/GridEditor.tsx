import { useRef, useState } from 'react'
import { useGraphStore } from '../../../state/graphStore'
import { useIOStore } from '../../../state/ioStore'
import type { GraphRig } from '../../../engine/GraphRig'
import { GRID_ROWS, GRID_COLS, IN_RAIL, OUT_RAIL, jack, jackKey } from '../../../engine/gridConfig'
import type { BlockKind } from '../../../engine/blocks/Block'
import { BlockCard } from '../BlockCard/BlockCard'
import { BlockPalette } from '../BlockPalette/BlockPalette'
import { BlockHighlight } from '../BlockHighlight/BlockHighlight'
import { CableLayer, type DragPreview } from '../CableLayer/CableLayer'
import { AddBlockMenu } from '../AddBlockMenu/AddBlockMenu'
import { InputDeviceDialog } from '../InputDeviceDialog/InputDeviceDialog'
import { OutputDeviceDialog } from '../OutputDeviceDialog/OutputDeviceDialog'
import { JackDisconnect } from '../JackDisconnect/JackDisconnect'
import { openCatalogForNewBlock } from '../openCatalogForNewBlock'
import { jackElementId, parseJackElementId } from '../jackId'
import { Knob } from '@/components/primitives/Knob/Knob'
import { HardwareButton } from '@/components/primitives/HardwareButton/HardwareButton'
import { LiveMeter } from '@/components/global/LiveMeter/LiveMeter'
import { BlockInspector } from '../BlockInspector/BlockInspector'
import { TunerDialog } from '../TunerDialog/TunerDialog'
import { Tuner } from '@/components/Tuner/Tuner'

import styles from './GridEditor.module.css'
export interface GridEditorProps {
  rig: GraphRig | null
  /** Taps the raw input signal - rendered as the tuner and the IN rail's level meter. */
  tunerAnalyser: AnalyserNode | null
  /** Post-graph output tap - rendered as the OUT rail's level meter. */
  analyser: AnalyserNode | null
  /** AudioContext.setSinkId support - passed through to the OUT rail's device dialog. */
  outputSelectionSupported: boolean
  /** AudioContext - passed through to the BlockInspector for NAM model evaluation. */
  context: AudioContext | null
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
export function GridEditor({
  rig,
  tunerAnalyser,
  analyser,
  outputSelectionSupported,
  context,
}: GridEditorProps) {
  const blocks = useGraphStore((s) => s.blocks)
  const edges = useGraphStore((s) => s.edges)
  const masterLevel = useGraphStore((s) => s.masterLevel)
  const setMasterLevel = useGraphStore((s) => s.setMasterLevel)
  const masterMuted = useGraphStore((s) => s.masterMuted)
  const setMasterMuted = useGraphStore((s) => s.setMasterMuted)
  const inputGain = useIOStore((s) => s.inputGain)
  const setInputGain = useIOStore((s) => s.setInputGain)
  const [addMenuCell, setAddMenuCell] = useState<{ row: number; col: number } | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const [blockDragCell, setBlockDragCell] = useState<{ row: number; col: number } | null>(null)
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [outputDialogOpen, setOutputDialogOpen] = useState(false)
  const draggingJackRef = useRef<string | null>(null)
  const [tunerOpen, setTunerOpen] = useState(false)

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
      const isDragTarget = blockDragCell?.row === row && blockDragCell?.col === col
      cells.push(
        <div
          key={`${row}-${col}`}
          className={styles.cell}
          style={{ gridRow: row + 1, gridColumn: col + 1 }}
        >
          {block ? (
            <BlockCard instance={block} rig={rig} onDragCellChange={setBlockDragCell} />
          ) : (
            <button
              type="button"
              className={`${styles.addCell} ${isDragTarget ? styles.addCellDragOver : ''}`}
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
      <div className={styles.paletteAndInspector}>
        <div className={styles.paletteAndInspectorItem}>
          <BlockPalette tunerAnalyser={tunerAnalyser} />
        </div>
        <div className={styles.paletteAndInspectorItem}>
          <BlockHighlight rig={rig} analyser={analyser} />
        </div>
        <div className={styles.paletteAndInspectorItem}>
          <BlockInspector rig={rig} context={context} />
        </div>
      </div>
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
          <HardwareButton
            fullWidth
            label="IN"
            onClick={() => setInputDialogOpen(true)}
            title="Input device and channel"
          />

          {/*   <HardwareButton
            fullWidth
            label="TUNER"
            onClick={() => setTunerOpen(true)}
            title="Open the full-size tuner (mutes output)"
          /> */}

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
          <Knob
            label="Trim"
            value={inputGain}
            min={0}
            max={2}
            defaultValue={1}
            onChange={setInputGain}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            size={46}
          />
          <LiveMeter label="Input" analyser={tunerAnalyser} />
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
          <HardwareButton
            fullWidth
            label="OUT"
            onClick={() => setOutputDialogOpen(true)}
            title="Output device and channel"
          />
          <HardwareButton
            label="MUTE"
            active={masterMuted}
            onClick={() => setMasterMuted(!masterMuted)}
          />

          <Knob
            label="Master"
            value={masterLevel}
            max={1.5}
            defaultValue={1}
            onChange={setMasterLevel}
            formatValue={(v) => v.toFixed(2)}
            size={46}
          />

          <LiveMeter label="Output" analyser={analyser} />

          <span className={`${styles.railJackWrap} ${styles.railJackWrapLeft}`}>
            <span
              className={styles.railJack}
              data-jack-id={jackElementId(OUT_RAIL, 'in', 0)}
              data-jack-side="in"
              title={
                outHasCable
                  ? 'Drag to rewire this cable, or click the badge on it to disconnect'
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
        </div>
      </div>

      {addMenuCell && (
        <AddBlockMenu
          open={!!addMenuCell}
          onPick={(kind: BlockKind) => {
            const id = useGraphStore.getState().addBlock(kind, addMenuCell.row, addMenuCell.col)
            openCatalogForNewBlock(id, kind)
            setAddMenuCell(null)
          }}
          onClose={() => setAddMenuCell(null)}
        />
      )}

      <InputDeviceDialog open={inputDialogOpen} onClose={() => setInputDialogOpen(false)} />
      <OutputDeviceDialog
        open={outputDialogOpen}
        onClose={() => setOutputDialogOpen(false)}
        outputSelectionSupported={outputSelectionSupported}
      />
      <TunerDialog open={tunerOpen} onClose={() => setTunerOpen(false)} analyser={tunerAnalyser} />
    </div>
  )
}
