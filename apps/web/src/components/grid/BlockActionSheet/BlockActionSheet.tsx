import { Dialog, HardwareButton } from '@openaxe/ui'
import styles from './BlockActionSheet.module.css'

export interface BlockActionSheetProps {
  open: boolean
  label: string
  onClose: () => void
  onRemove: () => void
  onMoveHint: () => void
  onDisconnectAll: () => void
  hasConnections: boolean
}

export function BlockActionSheet({
  open,
  label,
  onClose,
  onRemove,
  onMoveHint,
  onDisconnectAll,
  hasConnections,
}: BlockActionSheetProps) {
  return (
    <Dialog open={open} onClose={onClose} title={`${label} — actions`}>
      <div className={styles.sheet}>
        <p className={styles.hint}>
          Tap an empty cell to move this block. Connections must stay left→right (top→bottom on
          mobile).
        </p>
        <div className={styles.actions}>
          <HardwareButton label="Move — tap empty cell" onClick={onMoveHint} fullWidth />
          <HardwareButton label="Remove block" onClick={onRemove} fullWidth />
          {hasConnections && (
            <HardwareButton label="Disconnect all cables" onClick={onDisconnectAll} fullWidth />
          )}
        </div>
      </div>
    </Dialog>
  )
}
