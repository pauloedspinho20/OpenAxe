import { Chip, Dialog, HardwareButton, toast } from '@openaxe/ui'
import { useGraphStore } from '../../../state/graphStore'
import { useSelection } from '../../../state/selection'
import { BLOCK_KIND_LABELS } from '../blockOptions'
import { BLOCK_OPTIONS } from '../blockOptions'
import { blockColorVar } from '../blockColors'
import { jack } from '../../../engine/gridConfig'
import type { BlockKind } from '../../../engine/blocks/Block'
import { openCatalogForNewBlock } from '../openCatalogForNewBlock'
import styles from './BlockActionSheet.module.css'

export interface BlockActionSheetProps {
  open: boolean
  label: string
  blockId: string | null
  onClose: () => void
}

export function BlockActionSheet({ open, label, blockId, onClose }: BlockActionSheetProps) {
  const blocks = useGraphStore((s) => s.blocks)
  const edges = useGraphStore((s) => s.edges)
  const instance = blockId ? blocks.find((b) => b.id === blockId) : null

  if (!blockId || !instance) return null

  const incoming = edges.filter((e) => e.to.blockId === blockId)
  const outgoing = edges.filter((e) => e.from.blockId === blockId)
  const hasConnections = incoming.length > 0 || outgoing.length > 0

  const handleRemove = () => {
    useGraphStore.getState().removeBlock(blockId)
    useSelection.getState().clear()
    onClose()
  }

  const handleDisconnectAll = () => {
    incoming.forEach((e) => useGraphStore.getState().disconnect(e.id))
    outgoing.forEach((e) => useGraphStore.getState().disconnect(e.id))
    useGraphStore.getState().disconnectConnections(jack(blockId, 0), 'in')
    useGraphStore.getState().disconnectConnections(jack(blockId, 0), 'out')
    toast('Disconnected', { description: `${label} — all cables removed` })
  }

  const handleChangeKind = (kind: BlockKind) => {
    if (kind === instance.kind) {
      toast('Already is ' + BLOCK_KIND_LABELS[kind])
      return
    }
    const { row, col } = instance
    // Save cables to try to preserve them on the replacement when ports are compatible.
    const savedIncoming = [...incoming]
    const savedOutgoing = [...outgoing]
    useGraphStore.getState().removeBlock(blockId)
    const newId = useGraphStore.getState().addBlock(kind, row, col)
    if (newId === null) {
      // Restore old if add failed (e.g. Send/Return 1:1)
      const restoreId = useGraphStore.getState().addBlock(instance.kind, row, col)
      if (restoreId) {
        // Try to restore its previous cables best-effort.
        for (const e of savedIncoming) {
          useGraphStore.getState().connect(e.from, { blockId: restoreId, port: e.to.port })
        }
        for (const e of savedOutgoing) {
          useGraphStore.getState().connect({ blockId: restoreId, port: e.from.port }, e.to)
        }
        useSelection.getState().select(restoreId)
      }
      toast.warning(`${BLOCK_KIND_LABELS[kind]} is already on the grid`, {
        description: 'Send/Return blocks are strictly 1:1.',
      })
      return
    }
    // addBlock auto-wires a fresh IN→new→OUT / splice. For a replacement we want to
    // keep the previous routing instead, so drop whatever it just auto-wired.
    const afterEdges = useGraphStore.getState().edges
    for (const e of afterEdges) {
      if (e.from.blockId === newId || e.to.blockId === newId) {
        useGraphStore.getState().disconnect(e.id)
      }
    }
    // Re-attach saved cables where the new kind's ports allow it.
    let preserved = 0
    let dropped = 0
    for (const e of savedIncoming) {
      const res = useGraphStore.getState().connect(e.from, { blockId: newId, port: e.to.port })
      if (res.ok) preserved++
      else dropped++
    }
    for (const e of savedOutgoing) {
      const res = useGraphStore.getState().connect({ blockId: newId, port: e.from.port }, e.to)
      if (res.ok) preserved++
      else dropped++
    }
    if (dropped > 0) {
      toast.warning('Some cables could not be kept', {
        description: `${preserved} kept, ${dropped} dropped — new block has different jacks.`,
      })
    }
    openCatalogForNewBlock(newId, kind)
    useSelection.getState().select(newId)
    onClose()
  }

  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))

  return (
    <Dialog open={open} onClose={onClose} title={`${label} — actions`}>
      <div className={styles.sheet}>
        {/* Change block type — same list as Add a block */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Change block type</p>
          {/*   <p className={styles.hint}>Replace this slot with a different block. Current: {label}.</p> */}
          {groups.map((group) => (
            <div key={group} className={styles.group}>
              <span className={`label ${styles.groupLabel}`}>{group}</span>
              <div className={styles.options}>
                {BLOCK_OPTIONS.filter((o) => o.group === group).map((option) => {
                  const isCurrent = option.kind === instance.kind
                  return (
                    <Chip
                      key={option.kind}
                      disabled={option.disabled}
                      kind={option.kind}
                      aria-label={
                        option.disabled
                          ? `${option.label} - not yet available (${option.vendor})`
                          : isCurrent
                            ? `${option.label} (current)`
                            : undefined
                      }
                      title={
                        option.disabled
                          ? option.vendor
                          : isCurrent
                            ? 'Current block type'
                            : undefined
                      }
                      label={option.label + (isCurrent ? ' ✓' : '')}
                      style={{ '--block-color': blockColorVar(option.kind) } as React.CSSProperties}
                      onPick={() => handleChangeKind(option.kind)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Cables */}
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Cables</p>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className={styles.empty}>
              No cables. On mobile: tap an output jack then an input, then Confirm — or drag on
              desktop.
            </p>
          ) : (
            <div className={styles.connectionList}>
              {incoming.map((e) => {
                const src = blocks.find((b) => b.id === e.from.blockId)
                const srcLabel =
                  e.from.blockId === 'IN'
                    ? 'IN'
                    : src
                      ? BLOCK_KIND_LABELS[src.kind]
                      : e.from.blockId.slice(0, 4)
                return (
                  <div key={e.id} className={styles.connectionRow}>
                    <span>
                      ← {srcLabel} (in {e.to.port + 1})
                    </span>
                    <HardwareButton
                      label="Disconnect"
                      onClick={() => useGraphStore.getState().disconnect(e.id)}
                    />
                  </div>
                )
              })}
              {outgoing.map((e) => {
                const dst = blocks.find((b) => b.id === e.to.blockId)
                const dstLabel =
                  e.to.blockId === 'OUT'
                    ? 'OUT'
                    : dst
                      ? BLOCK_KIND_LABELS[dst.kind]
                      : e.to.blockId.slice(0, 4)
                return (
                  <div key={e.id} className={styles.connectionRow}>
                    <span>
                      → {dstLabel} (out {e.from.port + 1})
                    </span>
                    <HardwareButton
                      label="Disconnect"
                      onClick={() => useGraphStore.getState().disconnect(e.id)}
                    />
                  </div>
                )
              })}
              {hasConnections && (
                <HardwareButton
                  label="Disconnect all cables"
                  onClick={handleDisconnectAll}
                  fullWidth
                />
              )}
            </div>
          )}
        </div>

        {/* Destructive actions */}
        <div className={styles.section}>
          <HardwareButton label="Remove block" onClick={handleRemove} fullWidth />
        </div>
      </div>
    </Dialog>
  )
}
