import { useEffect, useRef, useState } from 'react'
import { useGraphStore } from '../../../state/graphStore'
import { useIOStore } from '../../../state/ioStore'
import type { GraphRig } from '../../../engine/GraphRig'
import { GRID_ROWS, GRID_COLS, IN_RAIL, OUT_RAIL, jack, jackKey } from '../../../engine/gridConfig'
import type { BlockKind } from '../../../engine/blocks/Block'
import { BlockCard, type BlockDragInfo } from '../BlockCard/BlockCard'
import { BlockPalette } from '../BlockPalette/BlockPalette'
import { CableLayer, type DragPreview } from '../CableLayer/CableLayer'
import { AddBlockMenu } from '../AddBlockMenu/AddBlockMenu'
import { InputDeviceDialog } from '../InputDeviceDialog/InputDeviceDialog'
import { OutputDeviceDialog } from '../OutputDeviceDialog/OutputDeviceDialog'
import { getShellKind } from '../../../native/openaxe'
import { JackDisconnect } from '../JackDisconnect/JackDisconnect'
import { openCatalogForNewBlock } from '../openCatalogForNewBlock'
import { jackElementId, parseJackElementId } from '../jackId'
import { HardwareButton, Knob, toast } from '@openaxe/ui'
import { LiveMeter } from '@/components/global/LiveMeter/LiveMeter'
import { BlockInspector } from '../BlockInspector/BlockInspector'
import { TunerDialog } from '../TunerDialog/TunerDialog'
import { Tuner } from '@/components/Tuner/Tuner'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import { BlockActionSheet } from '../BlockActionSheet/BlockActionSheet'
import { useSelection } from '../../../state/selection'

import styles from './GridEditor.module.css'

export interface GridEditorProps {
  rig: GraphRig | null
  tunerAnalyser: AnalyserNode | null
  analyser: AnalyserNode | null
  outputSelectionSupported: boolean
  context: AudioContext | null
}

function useIsMobile(breakpoint = 720) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])
  return isMobile
}

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
  const [blockDrag, setBlockDrag] = useState<BlockDragInfo | null>(null)
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [outputDialogOpen, setOutputDialogOpen] = useState(false)
  const isPluginShell = getShellKind() === 'plugin'
  const draggingJackRef = useRef<string | null>(null)
  const [tunerOpen, setTunerOpen] = useState(false)
  const isMobile = useIsMobile(720)
  const selectedBlockId = useSelection((s) => s.selectedBlockId)

  // Two-tap + confirm cabling (mobile)
  const [pendingJackId, setPendingJackId] = useState<string | null>(null)
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null)
  const [actionSheetBlockId, setActionSheetBlockId] = useState<string | null>(null)

  const outHasCable = edges.some((e) => e.to.blockId === OUT_RAIL)

  const clearPending = () => {
    setPendingJackId(null)
    setPendingTargetId(null)
  }

  const beginDrag = (el: HTMLElement, fromJackId: string, e: React.PointerEvent) => {
    e.preventDefault()
    try {
      el.setPointerCapture(e.pointerId)
    } catch {}
    draggingJackRef.current = fromJackId
    setDragPreview({ fromJackId, clientX: e.clientX, clientY: e.clientY })
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    const jackEl = (e.target as Element).closest('[data-jack-id]') as HTMLElement | null
    if (!jackEl) return
    const side = jackEl.dataset.jackSide
    const jackId = jackEl.dataset.jackId!

    // Coarse pointer: use two-tap + confirm flow instead of drag
    const isCoarse =
      (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
      isMobile
    if (isCoarse) {
      // If we already have a pending output and tap an input, set target and show confirm
      if (pendingJackId && side === 'in') {
        setPendingTargetId(jackId)
        return
      }
      // Tapping an output arms it
      if (side === 'out') {
        // Tapping same jack again disarms
        if (pendingJackId === jackId) {
          clearPending()
        } else {
          setPendingJackId(jackId)
          setPendingTargetId(null)
        }
        return
      }
      // Tapping an occupied input: arm its source output for rewire
      if (side === 'in') {
        const { jack: toJack } = parseJackElementId(jackId)
        const existing = useGraphStore
          .getState()
          .edges.find((edge) => jackKey(edge.to) === jackKey(toJack))
        if (!existing) return
        const sourceId = jackElementId(existing.from.blockId, 'out', existing.from.port)
        // Don't disconnect yet — only on confirm rewire; just arm
        setPendingJackId(sourceId)
        setPendingTargetId(null)
        return
      }
      return
    }

    if (side === 'out') {
      beginDrag(jackEl, jackId, e)
      return
    }

    if (side === 'in') {
      const { jack: toJack } = parseJackElementId(jackId)
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
      toast.warning("Can't connect those", { description: result.reason })
    }
  }

  const handleConfirmConnect = () => {
    if (!pendingJackId || !pendingTargetId) return
    const { jack: fromJack } = parseJackElementId(pendingJackId)
    const { jack: toJack } = parseJackElementId(pendingTargetId)
    // If rewire (target occupied), disconnect first
    const existing = useGraphStore
      .getState()
      .edges.find((edge) => jackKey(edge.to) === jackKey(toJack))
    if (existing) {
      useGraphStore.getState().disconnect(existing.id)
    }
    const result = useGraphStore.getState().connect(fromJack, toJack)
    if (!result.ok) {
      toast.warning("Can't connect those", { description: result.reason })
    }
    clearPending()
  }

  // Tap empty cell to move selected block (mobile alternative to drag)
  const handleEmptyCellClick = (row: number, col: number) => {
    if (isMobile && selectedBlockId) {
      const selected = blocks.find((b) => b.id === selectedBlockId)
      if (selected && (selected.row !== row || selected.col !== col)) {
        const occupied = blocks.some(
          (b) => b.id !== selectedBlockId && b.row === row && b.col === col,
        )
        if (occupied) return setAddMenuCell({ row, col })
        const result = useGraphStore.getState().moveBlock(selectedBlockId, row, col)
        if (!result.ok) toast.error("Can't move there", { description: result.reason })
        return
      }
    }
    setAddMenuCell({ row, col })
  }

  const cells = []
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const block = blocks.find((b) => b.row === row && b.col === col)
      const isDragTarget = blockDrag?.cell?.row === row && blockDrag?.cell?.col === col
      const dragClass = isDragTarget
        ? blockDrag.valid
          ? styles.addCellDragOver
          : styles.addCellDragOverInvalid
        : ''
      // On mobile transpose, visual row/col are swapped so signal flows top→bottom
      const visualRow = isMobile ? col + 1 : row + 1
      const visualCol = isMobile ? row + 1 : col + 1
      cells.push(
        <div
          key={`${row}-${col}`}
          className={styles.cell}
          style={{ gridRow: visualRow, gridColumn: visualCol }}
        >
          {block ? (
            <BlockCard
              instance={block}
              rig={rig}
              onDragChange={setBlockDrag}
              armedJackId={pendingJackId}
              onOpenMenu={() => setActionSheetBlockId(block.id)}
            />
          ) : (
            <button
              type="button"
              className={`${styles.addCell} ${dragClass}`}
              onClick={() => handleEmptyCellClick(row, col)}
              aria-label={`Add a block at row ${row + 1}, column ${col + 1}`}
            >
              +
            </button>
          )}
        </div>,
      )
    }
  }

  const actionSheetBlock = actionSheetBlockId
    ? blocks.find((b) => b.id === actionSheetBlockId)
    : null

  // Clear pending when clicking outside jacks
  const handleWrapClick = (e: React.MouseEvent) => {
    const target = e.target as Element
    if (!target.closest('[data-jack-id]') && pendingJackId && !pendingTargetId) {
      // don't clear immediately if user is just picking — require explicit cancel or outside tap
      // we clear on outside tap
      if (!target.closest(`.${styles.pendingBar}`)) clearPending()
    }
  }

  return (
    <div className={styles.editor}>
      <BlockInspector rig={rig} context={context} />
      {(pendingJackId || pendingTargetId) && (
        <div className={styles.pendingBar} data-testid="pending-bar">
          <span className={styles.pendingText}>
            {!pendingJackId
              ? 'Tap an output jack to start'
              : !pendingTargetId
                ? 'Output armed — now tap an input jack'
                : `Ready: ${pendingJackId} → ${pendingTargetId}`}
          </span>
          <div className={styles.pendingActions}>
            {pendingJackId && pendingTargetId && (
              <HardwareButton label="Connect" onClick={handleConfirmConnect} />
            )}
            <HardwareButton label="Cancel" onClick={clearPending} />
          </div>
        </div>
      )}
      <div
        className={styles.wrap}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleWrapClick}
      >
        <CableLayer
          edges={edges}
          recomputeKey={[blocks, blockDrag?.offset, blockDrag?.id, isMobile]}
          dragPreview={dragPreview}
          pendingConnection={
            pendingJackId && pendingTargetId
              ? { fromJackId: pendingJackId, toJackId: pendingTargetId }
              : null
          }
          onDisconnect={(edgeId) => useGraphStore.getState().disconnect(edgeId)}
        />

        <div className={`${styles.rail} ${styles.railIn}`}>
          <HardwareButton
            fullWidth
            label="IN"
            onClick={() => setInputDialogOpen(true)}
            title={isPluginShell ? 'Input channel' : 'Input device and channel'}
          />

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
              className={`${styles.railJack} ${pendingJackId === jackElementId(IN_RAIL, 'out', 0) ? styles.railJackArmed : ''}`}
              data-jack-id={jackElementId(IN_RAIL, 'out', 0)}
              data-jack-side="out"
              title="Output — tap then tap input, or drag"
            />
          </span>
        </div>

        <div className={styles.grid} data-grid-bounds data-transposed={isMobile ? 'true' : 'false'}>
          {cells}
        </div>

        <div className={`${styles.rail} ${styles.railOut}`}>
          <HardwareButton
            fullWidth
            label="OUT"
            onClick={() => setOutputDialogOpen(true)}
            disabled={isPluginShell}
            title={
              isPluginShell ? "The DAW takes this plugin's output" : 'Output device and channel'
            }
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
              className={`${styles.railJack} ${pendingTargetId === jackElementId(OUT_RAIL, 'in', 0) ? styles.railJackArmed : ''}`}
              data-jack-id={jackElementId(OUT_RAIL, 'in', 0)}
              data-jack-side="in"
              title={
                outHasCable
                  ? 'Tap to rewire or click badge to disconnect — or drag'
                  : 'Input — tap output then here, or drag'
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
            if (id === null) {
              toast.warning(`${BLOCK_KIND_LABELS[kind]} is already on the grid`, {
                description: 'Send/Return blocks are strictly 1:1.',
              })
              setAddMenuCell(null)
              return
            }
            openCatalogForNewBlock(id, kind)
            setAddMenuCell(null)
          }}
          onClose={() => setAddMenuCell(null)}
        />
      )}

      <BlockPalette tunerAnalyser={tunerAnalyser} />

      {actionSheetBlock && (
        <BlockActionSheet
          open={!!actionSheetBlock}
          label={BLOCK_KIND_LABELS[actionSheetBlock.kind]}
          blockId={actionSheetBlockId}
          onClose={() => setActionSheetBlockId(null)}
        />
      )}

      <InputDeviceDialog open={inputDialogOpen} onClose={() => setInputDialogOpen(false)} />
      {!isPluginShell && (
        <OutputDeviceDialog
          open={outputDialogOpen}
          onClose={() => setOutputDialogOpen(false)}
          outputSelectionSupported={outputSelectionSupported}
        />
      )}
      <TunerDialog open={tunerOpen} onClose={() => setTunerOpen(false)} analyser={tunerAnalyser} />
    </div>
  )
}
