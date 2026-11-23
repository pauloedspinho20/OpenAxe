import type { ReactNode } from 'react'
import { ButtonGroup } from '../ButtonGroup/ButtonGroup'
import { HardwareButton, type HardwareButtonProps } from '../HardwareButton/HardwareButton'
import styles from './Stepper.module.css'

export interface StepperProps {
  label: string
  value: ReactNode
  onDecrement: () => void
  onIncrement: () => void
  onReset?: (() => void) | undefined
  decrementLabel: string
  incrementLabel: string
  decrementTitle?: string | undefined
  incrementTitle?: string | undefined
  resetLabel?: string | undefined
  resetTitle?: string | undefined
  decrementIcon?: ReactNode
  incrementIcon?: ReactNode
  decrementText?: string | undefined
  incrementText?: string | undefined
  decrementDisabled?: boolean | undefined
  incrementDisabled?: boolean | undefined
  size?: HardwareButtonProps['size']
  focusableWhenDisabled?: boolean | undefined
  className?: string | undefined
}

/**
 * Unified increment/decrement control with a central tabular-nums readout
 * (and optional click-to-reset action), built on ButtonGroup + HardwareButton.
 */
export function Stepper({
  label,
  value,
  onDecrement,
  onIncrement,
  onReset,
  decrementLabel,
  incrementLabel,
  decrementTitle,
  incrementTitle,
  resetLabel,
  resetTitle,
  decrementIcon,
  incrementIcon,
  decrementText = '−',
  incrementText = '+',
  decrementDisabled = false,
  incrementDisabled = false,
  size = 'small',
  focusableWhenDisabled = false,
  className,
}: StepperProps) {
  return (
    <ButtonGroup label={label} size={size} className={className}>
      <HardwareButton
        size={size}
        iconOnly={Boolean(decrementIcon)}
        icon={decrementIcon}
        label={decrementIcon ? decrementLabel : decrementText}
        ariaLabel={decrementLabel}
        title={decrementTitle ?? decrementLabel}
        disabled={decrementDisabled}
        focusableWhenDisabled={focusableWhenDisabled}
        onClick={onDecrement}
      />
      {onReset ? (
        <button
          type="button"
          className={styles.value}
          onClick={onReset}
          aria-label={resetLabel ?? `Reset ${label}`}
          title={resetTitle ?? resetLabel ?? `Reset ${label}`}
        >
          {value}
        </button>
      ) : (
        <output className={styles.value} aria-label={label}>
          {value}
        </output>
      )}
      <HardwareButton
        size={size}
        iconOnly={Boolean(incrementIcon)}
        icon={incrementIcon}
        label={incrementIcon ? incrementLabel : incrementText}
        ariaLabel={incrementLabel}
        title={incrementTitle ?? incrementLabel}
        disabled={incrementDisabled}
        focusableWhenDisabled={focusableWhenDisabled}
        onClick={onIncrement}
      />
    </ButtonGroup>
  )
}
