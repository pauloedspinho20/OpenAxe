import type { HTMLAttributes } from 'react'
import { BlockIcon } from '@openaxe/ui'
import type { BlockKind } from '../../../engine/blocks/Block'
import { blockColorVar } from '../blockColors'
import styles from './BlockPalette.module.css'

export interface BlockChipProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  kind: BlockKind
  label: string
  disabled?: boolean | undefined
  dragging?: boolean | undefined
  /** Fixed square size for use outside the palette's container-sized grid (e.g. dialogs). */
  size?: number | undefined
}

/** The compact hardware-tile chip used by the bottom palette and the Add-a-block dialog. */
export function BlockChip({
  kind,
  label,
  disabled,
  dragging,
  size,
  style,
  className,
  ...rest
}: BlockChipProps) {
  return (
    <div
      className={`${styles.chip} ${disabled ? styles.chipDisabled : ''} ${dragging ? styles.chipDragging : ''} ${className ?? ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      style={
        {
          '--block-color': blockColorVar(kind),
          ...(size ? { width: size, height: size, flex: `0 0 ${size}px` } : null),
          ...style,
        } as React.CSSProperties
      }
      {...rest}
    >
      <BlockIcon kind={kind} size={22} className={styles.chipIcon} />
      <span className={styles.chipLabel}>{label}</span>
    </div>
  )
}
