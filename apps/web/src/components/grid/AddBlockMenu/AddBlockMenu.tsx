import type { BlockKind } from '../../../engine/blocks/Block'
import { BLOCK_OPTIONS } from '../blockOptions'
import { Dialog } from '@openaxe/ui'
import { BlockChip } from '../BlockPalette/BlockChip'
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
              <BlockChip
                key={option.kind}
                kind={option.kind}
                label={option.label}
                size={64}
                role="menuitem"
                disabled={option.disabled}
                aria-label={
                  option.disabled
                    ? `${option.label} - not yet available (${option.vendor})`
                    : option.label
                }
                title={option.disabled ? option.vendor : undefined}
                onClick={() => {
                  if (!option.disabled) onPick(option.kind)
                }}
                onKeyDown={(e) => {
                  if (!option.disabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onPick(option.kind)
                  }
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </Dialog>
  )
}
