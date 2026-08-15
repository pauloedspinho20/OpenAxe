import type { BlockKind } from '../../../engine/blocks/Block'
import { BLOCK_OPTIONS } from '../blockOptions'
import { BlockIcon } from '../blockIcons'
import { Dialog } from '@nam/ui'
import styles from './AddBlockMenu.module.css'

export interface AddBlockMenuProps {
  open: boolean
  onPick: (kind: BlockKind) => void
  onClose: () => void
}

export function AddBlockMenu({ open, onPick, onClose }: AddBlockMenuProps) {
  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))

  return (
    <Dialog open={open} onClose={onClose} title="Add a block" width="min(220px, 90vw)">
      {groups.map((group) => (
        <div key={group} className={styles.group}>
          <span className={`label ${styles.groupLabel}`}>{group}</span>
          <div className={styles.options}>
            {BLOCK_OPTIONS.filter((o) => o.group === group).map((option) => (
              <button
                key={option.kind}
                type="button"
                role="menuitem"
                className={`${styles.option} ${option.disabled ? styles.optionDisabled : ''}`}
                disabled={option.disabled}
                aria-label={
                  option.disabled
                    ? `${option.label} - not yet available (${option.vendor})`
                    : undefined
                }
                title={option.disabled ? option.vendor : undefined}
                onClick={() => !option.disabled && onPick(option.kind)}
              >
                <BlockIcon kind={option.kind} size={12} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  )
}
