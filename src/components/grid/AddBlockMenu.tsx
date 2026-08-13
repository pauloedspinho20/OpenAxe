import type { BlockKind } from '../../engine/blocks/Block'
import { BLOCK_OPTIONS } from './blockOptions'
import { BlockIcon } from './blockIcons'
import styles from './AddBlockMenu.module.css'

export interface AddBlockMenuProps {
  onPick: (kind: BlockKind) => void
  onClose: () => void
}

/** Popover shown when an empty grid cell is clicked - pick a block kind to place there. */
export function AddBlockMenu({ onPick, onClose }: AddBlockMenuProps) {
  const groups = Array.from(new Set(BLOCK_OPTIONS.map((o) => o.group)))

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.menu}
        role="menu"
        aria-label="Add a block"
        onClick={(e) => e.stopPropagation()}
      >
        {groups.map((group) => (
          <div key={group} className={styles.group}>
            <span className={`label ${styles.groupLabel}`}>{group}</span>
            <div className={styles.options}>
              {BLOCK_OPTIONS.filter((o) => o.group === group).map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  role="menuitem"
                  className={styles.option}
                  onClick={() => onPick(option.kind)}
                >
                  <BlockIcon kind={option.kind} size={12} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
