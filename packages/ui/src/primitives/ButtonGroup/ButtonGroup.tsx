import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { HardwareButton, type HardwareButtonProps } from '../HardwareButton/HardwareButton'
import styles from './ButtonGroup.module.css'

export type ButtonGroupMode = 'group' | 'radiogroup' | 'tablist' | 'nav'

export interface ButtonGroupItem<T extends string = string> {
  value: T
  label: string
  icon?: ReactNode
  trailingIcon?: ReactNode
  badge?: string | number | undefined
  ariaLabel?: string | undefined
  title?: string | undefined
  disabled?: boolean | undefined
  variant?: HardwareButtonProps['variant']
  hideLabelBelow?: HardwareButtonProps['hideLabelBelow']
  iconOnly?: boolean | undefined
  active?: boolean | undefined
}

export interface ButtonGroupProps<T extends string = string> {
  label: string
  mode?: ButtonGroupMode | undefined
  items?: readonly ButtonGroupItem<T>[] | undefined
  value?: T | null | undefined
  onChange?: ((value: T) => void) | undefined
  children?: ReactNode
  size?: HardwareButtonProps['size']
  orientation?: 'horizontal' | 'vertical' | undefined
  stretch?: boolean | undefined
  scrollable?: boolean | undefined
  focusableWhenDisabled?: boolean | undefined
  title?: string | undefined
  className?: string | undefined
}

/**
 * Shared container for grouped HardwareButtons: standard button trays,
 * exclusive radiogroups, ARIA tablists, and view navigation landmarks.
 */
export function ButtonGroup<T extends string = string>({
  label,
  mode = 'group',
  items,
  value,
  onChange,
  children,
  size = 'small',
  orientation = 'horizontal',
  stretch = false,
  scrollable = false,
  focusableWhenDisabled = false,
  title,
  className,
}: ButtonGroupProps<T>) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const useRovingSelection = (mode === 'radiogroup' || mode === 'tablist') && Boolean(items?.length)

  const enabledIndices = items
    ? items.reduce<number[]>((acc, item, idx) => {
        if (!item.disabled) acc.push(idx)
        return acc
      }, [])
    : []

  const selectedIndex = items
    ? items.findIndex((item) => item.value === value && !item.disabled)
    : -1
  const rovingFocusIndex = selectedIndex >= 0 ? selectedIndex : (enabledIndices[0] ?? -1)

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!useRovingSelection || !items || enabledIndices.length === 0) return

    const activeEl = document.activeElement
    const currentIdx = itemRefs.current.findIndex((el) => el === activeEl)
    if (currentIdx < 0) return

    const posInEnabled = enabledIndices.indexOf(currentIdx)
    if (posInEnabled < 0) return

    const rtl =
      typeof getComputedStyle === 'function' &&
      getComputedStyle(e.currentTarget).direction === 'rtl'

    let step = 0
    if (orientation === 'vertical') {
      if (e.key === 'ArrowDown') step = 1
      else if (e.key === 'ArrowUp') step = -1
    } else {
      if (e.key === 'ArrowRight') step = rtl ? -1 : 1
      else if (e.key === 'ArrowLeft') step = rtl ? 1 : -1
    }

    let nextIdx: number | null = null
    if (step !== 0) {
      const nextPos = (posInEnabled + step + enabledIndices.length) % enabledIndices.length
      nextIdx = enabledIndices[nextPos] ?? null
    } else if (e.key === 'Home') {
      nextIdx = enabledIndices[0] ?? null
    } else if (e.key === 'End') {
      nextIdx = enabledIndices[enabledIndices.length - 1] ?? null
    }

    if (nextIdx === null) return
    const nextItem = items[nextIdx]
    if (!nextItem) return
    e.preventDefault()
    itemRefs.current[nextIdx]?.focus()
    onChange?.(nextItem.value)
  }

  const cls = [
    styles.group,
    orientation === 'vertical' ? styles.vertical : '',
    stretch ? styles.stretch : '',
    scrollable ? styles.scrollable : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = items
    ? items.map((item, idx) => {
        const isSelected = value !== undefined && item.value === value
        const buttonRole = mode === 'radiogroup' ? 'radio' : mode === 'tablist' ? 'tab' : undefined
        const activeProp =
          mode === 'nav'
            ? undefined
            : item.active !== undefined
              ? item.active
              : value !== undefined || mode !== 'group'
                ? isSelected
                : undefined

        return (
          <HardwareButton
            key={item.value}
            ref={(el) => {
              itemRefs.current[idx] = el
            }}
            size={size}
            label={item.label}
            icon={item.icon}
            trailingIcon={item.trailingIcon}
            badge={item.badge}
            ariaLabel={item.ariaLabel}
            title={item.title}
            disabled={item.disabled}
            focusableWhenDisabled={focusableWhenDisabled}
            variant={item.variant}
            hideLabelBelow={item.hideLabelBelow}
            iconOnly={item.iconOnly}
            role={buttonRole}
            active={activeProp}
            ariaCurrent={mode === 'nav' ? (isSelected ? 'page' : false) : undefined}
            tabIndex={useRovingSelection ? (idx === rovingFocusIndex ? 0 : -1) : undefined}
            onClick={() => onChange?.(item.value)}
          />
        )
      })
    : children

  if (mode === 'nav') {
    return (
      <nav aria-label={label} className={cls} title={title}>
        {content}
      </nav>
    )
  }

  return (
    <div
      role={mode}
      aria-label={label}
      aria-orientation={mode === 'tablist' && orientation === 'vertical' ? 'vertical' : undefined}
      className={cls}
      title={title}
      onKeyDown={useRovingSelection ? handleKeyDown : undefined}
    >
      {content}
    </div>
  )
}
