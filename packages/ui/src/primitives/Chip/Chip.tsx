import { BlockIcon, type BlockKind } from '../../icons'
import styles from './Chip.module.css'

export interface ChipProps {
  label: string
  kind: BlockKind
  onPick: (kind: BlockKind) => void
  disabled?: boolean | undefined
  'aria-label'?: string | undefined
  title?: string | undefined
  style?: React.CSSProperties | undefined
}

export function Chip({
  label,
  kind,
  onPick,
  disabled = false,
  'aria-label': ariaLabel,
  title,
  style,
}: ChipProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={[styles.chip, disabled ? styles.chipDisabled : ''].filter(Boolean).join(' ')}
      disabled={disabled}
      aria-label={ariaLabel ?? (disabled ? `${label} - not yet available` : undefined)}
      title={title ?? (disabled ? 'not yet available' : undefined)}
      style={style}
      onClick={() => !disabled && onPick(kind)}
    >
      <BlockIcon kind={kind} size={18} />
      <span>{label}</span>
    </button>
  )
}
