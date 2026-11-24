import type { CSSProperties, MouseEvent, ReactNode, Ref } from 'react'
import styles from './HardwareButton.module.css'

export interface HardwareButtonProps {
  label: string
  active?: boolean | undefined
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined
  type?: 'button' | 'submit' | 'reset' | undefined
  variant?: 'default' | 'accent' | 'danger' | undefined
  disabled?: boolean | undefined
  /** Keep the button in roving-toolbar arrow navigation with `aria-disabled` instead of `disabled`. */
  focusableWhenDisabled?: boolean | undefined
  title?: string | undefined
  fullWidth?: boolean | undefined
  icon?: ReactNode
  trailingIcon?: ReactNode
  badge?: string | number | undefined
  size?: 'small' | 'medium' | 'large' | undefined
  iconOnly?: boolean | undefined
  hideLabelBelow?: 'sm' | 'md' | 'never' | undefined
  /** Accessible name when the visible label is only a short tag (e.g. "1" for "Loop 1 bar"). */
  ariaLabel?: string | undefined
  ariaExpanded?: boolean | undefined
  ariaControls?: string | undefined
  ariaCurrent?: 'page' | 'step' | 'location' | 'date' | 'time' | true | false | undefined
  popoverTarget?: string | undefined
  role?: 'button' | 'radio' | 'tab' | undefined
  tabIndex?: number | undefined
  className?: string | undefined
  style?: CSSProperties | undefined
  ref?: Ref<HTMLButtonElement> | undefined
}

/** A tactile rack button. Pass `active` for toggles (`aria-pressed`); omit it on one-shot actions. */
export function HardwareButton({
  label,
  active,
  onClick,
  type = 'button',
  variant = 'default',
  disabled = false,
  focusableWhenDisabled = false,
  title,
  fullWidth = false,
  icon,
  trailingIcon,
  badge,
  size = 'medium',
  iconOnly = false,
  hideLabelBelow = 'never',
  ariaLabel,
  ariaExpanded,
  ariaControls,
  ariaCurrent,
  popoverTarget,
  role,
  tabIndex,
  className,
  style,
  ref,
}: HardwareButtonProps) {
  const isAriaDisabled = Boolean(disabled && focusableWhenDisabled)
  const nativeDisabled = Boolean(disabled && !focusableWhenDisabled)
  const isActive = Boolean(active) || (ariaCurrent !== undefined && ariaCurrent !== false)
  const hasVisibleContent = Boolean(icon || trailingIcon || (badge !== undefined && badge !== ''))
  const accessibleLabel = ariaLabel ?? (iconOnly || hideLabelBelow !== 'never' ? label : undefined)
  const tooltip = title ?? (ariaLabel ? ariaLabel : iconOnly ? label : undefined)
  const hasBadge = badge !== undefined && badge !== ''

  const hideLabelClass =
    hideLabelBelow === 'sm' ? styles.hideLabelSm : hideLabelBelow === 'md' ? styles.hideLabelMd : ''
  const collapseClass =
    !trailingIcon && !hasBadge && icon
      ? hideLabelBelow === 'sm'
        ? styles.compactBelowSm
        : hideLabelBelow === 'md'
          ? styles.compactBelowMd
          : ''
      : ''

  const cls = [
    styles.button,
    isActive ? styles.active : '',
    styles[variant],
    fullWidth ? styles.fullWidth : '',
    hasVisibleContent ? styles.withIcon : '',
    styles[size],
    iconOnly ? styles.iconOnly : '',
    collapseClass,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const roleProp = role === 'radio' || role === 'tab' ? { role } : {}
  const ariaStateProps =
    role === 'radio'
      ? { 'aria-checked': Boolean(active) }
      : role === 'tab'
        ? { 'aria-selected': Boolean(active) }
        : ariaCurrent !== undefined
          ? { 'aria-current': ariaCurrent || undefined }
          : active !== undefined
            ? { 'aria-pressed': active }
            : {}

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      onClick={handleClick}
      disabled={nativeDisabled}
      aria-disabled={isAriaDisabled ? 'true' : undefined}
      data-variant={variant}
      data-disabled={disabled ? 'true' : undefined}
      {...roleProp}
      {...ariaStateProps}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-label={accessibleLabel}
      {...(popoverTarget !== undefined ? { popoverTarget } : {})}
      {...(tabIndex !== undefined ? { tabIndex } : {})}
      {...(style !== undefined ? { style } : {})}
      title={tooltip}
    >
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {iconOnly ? (
        <span className={styles.visuallyHidden}>{label}</span>
      ) : (
        <span className={[styles.label, hideLabelClass].filter(Boolean).join(' ')}>{label}</span>
      )}
      {hasBadge ? (
        <span className={styles.badge} aria-hidden={Boolean(accessibleLabel) || undefined}>
          {badge}
        </span>
      ) : null}
      {trailingIcon ? (
        <span className={styles.trailingIcon} aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  )
}
