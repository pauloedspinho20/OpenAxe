import type { BlockKind } from '../../../engine/blocks/Block'
import { BLOCK_OPTIONS } from '../blockOptions'
import { BlockIcon, Dialog } from '@openaxe/ui'
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
                style={{ '--block-color': blockColorVar(option.kind) } as React.CSSProperties}
              >
                <BlockIcon kind={option.kind} size={18} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  )
}
