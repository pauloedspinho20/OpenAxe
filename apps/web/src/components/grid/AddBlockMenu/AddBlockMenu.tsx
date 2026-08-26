import type { BlockKind } from '../../../engine/blocks/Block'
import { BLOCK_OPTIONS } from '../blockOptions'
import { Chip, Dialog } from '@openaxe/ui'
import { blockColorVar } from '../blockColors'
import styles from './AddBlockMenu.module.css'

export interface AddBlockMenuProps {
  open: boolean
  onPick: (kind: BlockKind) => void
  onClose: () => void
}

export function AddBlockMenu({ open, onPick, onClose }: AddBlockMenuProps) {
  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))

  return (
    <Dialog open={open} onClose={onClose} title="Add a block">
      {groups.map((group) => (
        <div key={group} className={styles.group}>
          <span className={`label ${styles.groupLabel}`}>{group}</span>
          <div className={styles.options}>
            {BLOCK_OPTIONS.filter((o) => o.group === group).map((option) => (
              <Chip
                key={option.kind}
                disabled={option.disabled}
                kind={option.kind}
                aria-label={
                  option.disabled
                    ? `${option.label} - not yet available (${option.vendor})`
                    : undefined
                }
                title={option.disabled ? option.vendor : undefined}
                label={option.label}
                style={{ '--block-color': blockColorVar(option.kind) } as React.CSSProperties}
                onPick={() => onPick(option.kind)}
              />
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  )
}
