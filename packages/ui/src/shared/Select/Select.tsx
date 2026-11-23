import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import styles from './Select.module.css'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Optional visible label rendered above the select. When omitted the select renders standalone (use aria-label for accessibility). */
  label?: string | undefined
  children: ReactNode
}

interface ParsedOption {
  kind: 'option'
  value: string
  label: string
  disabled: boolean
  index: number
}

interface ParsedGroup {
  kind: 'group'
  label: string
  disabled: boolean
  options: ParsedOption[]
}

type ParsedNode = ParsedOption | ParsedGroup

const supportsNativePopover = () =>
  typeof HTMLElement !== 'undefined' &&
  'popover' in HTMLElement.prototype &&
  typeof HTMLElement.prototype.showPopover === 'function'

const supportsAnchorPositioning = () =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('position-area', 'block-end') &&
  CSS.supports('min-inline-size', 'anchor-size(width)')

function toValueString(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return String(value[0] ?? '')
  return String(value)
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children)
  return ''
}

function parseSelectChildren(children: ReactNode): {
  nodes: ParsedNode[]
  flat: ParsedOption[]
} {
  const flat: ParsedOption[] = []

  const walk = (input: ReactNode, inheritedDisabled = false): ParsedNode[] => {
    const result: ParsedNode[] = []
    Children.forEach(input, (child) => {
      if (!isValidElement(child)) return
      if (child.type === Fragment) {
        result.push(
          ...walk(
            (child as ReactElement<{ children?: ReactNode }>).props.children,
            inheritedDisabled,
          ),
        )
        return
      }
      if (child.type === 'optgroup') {
        const el = child as ReactElement<{
          label?: string
          disabled?: boolean
          children?: ReactNode
        }>
        const groupDisabled = inheritedDisabled || Boolean(el.props.disabled)
        const groupChildren = walk(el.props.children, groupDisabled).filter(
          (n): n is ParsedOption => n.kind === 'option',
        )
        result.push({
          kind: 'group',
          label: el.props.label ?? '',
          disabled: groupDisabled,
          options: groupChildren,
        })
        return
      }
      if (child.type === 'option') {
        const el = child as ReactElement<{
          value?: string | number | readonly string[]
          disabled?: boolean
          children?: ReactNode
        }>
        const optLabel = extractText(el.props.children)
        const optValue = el.props.value !== undefined ? toValueString(el.props.value) : optLabel
        const opt: ParsedOption = {
          kind: 'option',
          value: optValue,
          label: optLabel,
          disabled: inheritedDisabled || Boolean(el.props.disabled),
          index: flat.length,
        }
        flat.push(opt)
        result.push(opt)
        return
      }
      const el = child as ReactElement<{ children?: ReactNode }>
      if (el.props && 'children' in el.props && el.props.children !== undefined) {
        result.push(...walk(el.props.children, inheritedDisabled))
      }
    })
    return result
  }

  return { nodes: walk(children), flat }
}

function findEnabledIndex(flat: ParsedOption[], preferredValue: string): number {
  const exact = flat.findIndex((o) => o.value === preferredValue && !o.disabled)
  if (exact >= 0) return exact
  const anyMatch = flat.findIndex((o) => o.value === preferredValue)
  if (anyMatch >= 0 && !flat[anyMatch]!.disabled) return anyMatch
  const firstEnabled = flat.findIndex((o) => !o.disabled)
  return firstEnabled >= 0 ? firstEnabled : 0
}

function stepEnabled(flat: ParsedOption[], from: number, delta: 1 | -1): number {
  if (flat.length === 0) return -1
  for (let step = 1; step <= flat.length; step++) {
    const idx = (from + delta * step + flat.length) % flat.length
    if (!flat[idx]!.disabled) return idx
  }
  return from
}

function firstEnabled(flat: ParsedOption[]): number {
  return flat.findIndex((o) => !o.disabled)
}

function lastEnabled(flat: ParsedOption[]): number {
  for (let i = flat.length - 1; i >= 0; i--) {
    if (!flat[i]!.disabled) return i
  }
  return -1
}

export function Select({
  label,
  children,
  id,
  className,
  style,
  value,
  defaultValue,
  onChange,
  disabled = false,
  name,
  title,
  autoFocus,
  tabIndex,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
}: SelectProps) {
  const rawUid = useId()
  const safeUid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '')
  const anchorName = `--ox-sel-${safeUid}`
  const selectId = id ?? (label ? `select-${safeUid}` : undefined)
  const listboxId = `listbox-${safeUid}`

  const { nodes, flat } = useMemo(() => parseSelectChildren(children), [children])
  const isControlled = value !== undefined
  const [uncontrolledValue, setUncontrolledValue] = useState<string>(() => {
    if (defaultValue !== undefined) return toValueString(defaultValue)
    return flat.find((o) => !o.disabled)?.value ?? flat[0]?.value ?? ''
  })

  const currentValue = isControlled ? toValueString(value) : uncontrolledValue
  const selectedOption =
    flat.find((o) => o.value === currentValue) ?? flat.find((o) => !o.disabled) ?? flat[0]

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(() => findEnabledIndex(flat, currentValue))

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const suppressNextClickRef = useRef(false)
  const typeaheadRef = useRef<{ buffer: string; timer: number | undefined }>({
    buffer: '',
    timer: undefined,
  })

  const nativePopover = supportsNativePopover()

  const placeFallback = useCallback(() => {
    const trigger = triggerRef.current
    const listbox = listboxRef.current
    if (!trigger || !listbox) return
    if (supportsAnchorPositioning()) {
      listbox.style.top = ''
      listbox.style.left = ''
      listbox.style.minWidth = ''
      listbox.style.position = ''
      listbox.style.inset = ''
      listbox.style.margin = ''
      return
    }
    const tr = trigger.getBoundingClientRect()
    const pr = listbox.getBoundingClientRect()
    const pad = 8
    const minWidth = Math.max(tr.width, 0)
    const measuredWidth = Math.max(pr.width, minWidth)
    const fitsBelow = tr.bottom + pr.height + 4 <= window.innerHeight - pad
    const fitsAbove = tr.top - pr.height - 4 >= pad
    const putTop = !fitsBelow && fitsAbove
    const top = putTop
      ? Math.max(pad, tr.top - pr.height - 4)
      : Math.min(window.innerHeight - pr.height - pad, tr.bottom + 4)
    const left = Math.max(pad, Math.min(tr.left, window.innerWidth - measuredWidth - pad))
    listbox.style.position = 'fixed'
    listbox.style.inset = 'auto'
    listbox.style.margin = '0'
    listbox.style.minWidth = `${Math.round(minWidth)}px`
    listbox.style.top = `${Math.round(top)}px`
    listbox.style.left = `${Math.round(left)}px`
  }, [])

  const openMenu = useCallback(
    (initialIdx?: number) => {
      if (disabled || flat.length === 0) return
      const nextActive =
        initialIdx !== undefined && initialIdx >= 0
          ? initialIdx
          : findEnabledIndex(flat, currentValue)
      setActiveIndex(nextActive)
      setOpen(true)
    },
    [disabled, flat, currentValue],
  )

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      const lb = listboxRef.current
      if (nativePopover && lb && lb.matches(':popover-open')) {
        try {
          lb.hidePopover()
        } catch {
          // ignore
        }
      }
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus()
    },
    [nativePopover],
  )

  const selectValue = useCallback(
    (nextValue: string) => {
      if (!isControlled) setUncontrolledValue(nextValue)
      if (onChange && nextValue !== currentValue) {
        const target = { value: nextValue, name: name ?? '' }
        const synthetic = {
          target,
          currentTarget: target,
        } as unknown as ChangeEvent<HTMLSelectElement>
        onChange(synthetic)
      }
      closeMenu(true)
    },
    [isControlled, onChange, currentValue, name, closeMenu],
  )

  // Keep React `open` state aligned with native `popover="auto"` light-dismiss.
  useEffect(() => {
    const lb = listboxRef.current
    if (!lb || !nativePopover) return
    const onToggle = (e: Event) => {
      const ev = e as ToggleEvent
      setOpen(ev.newState === 'open' && lb.matches(':popover-open'))
    }
    lb.addEventListener('toggle', onToggle)
    return () => lb.removeEventListener('toggle', onToggle)
  }, [nativePopover])

  // Sync native Popover API top-layer state after options mount, keep fallback placement accurate.
  useLayoutEffect(() => {
    const lb = listboxRef.current
    if (!open) {
      if (nativePopover && lb && lb.matches(':popover-open')) {
        try {
          lb.hidePopover()
        } catch {
          // ignore
        }
      }
      return
    }
    if (nativePopover && lb && !lb.matches(':popover-open')) {
      try {
        lb.showPopover()
      } catch {
        // Fall through to React-managed fixed overlay.
      }
    }
    placeFallback()
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
    const raf =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(placeFallback) : 0
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [open, activeIndex, nativePopover, placeFallback])

  // Capture-phase Escape closes ONLY this open Select (without dismissing parent Dialog/Popover).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        closeMenu(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, closeMenu])

  // Outside pointerdown dismissal when native popover="auto" is not driving light-dismiss.
  useEffect(() => {
    if (!open || nativePopover) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, nativePopover])

  useEffect(() => {
    const typeahead = typeaheadRef.current
    return () => {
      if (typeahead.timer !== undefined) {
        window.clearTimeout(typeahead.timer)
      }
    }
  }, [])

  const handleTypeahead = (ch: string) => {
    if (flat.length === 0) return
    const state = typeaheadRef.current
    if (state.timer !== undefined) window.clearTimeout(state.timer)
    state.buffer += ch.toLowerCase()
    state.timer = window.setTimeout(() => {
      state.buffer = ''
      state.timer = undefined
    }, 500)

    const start = open ? Math.max(0, activeIndex) : findEnabledIndex(flat, currentValue)
    const matchIndex = flat.findIndex(
      (o, idx) => idx >= start && !o.disabled && o.label.toLowerCase().startsWith(state.buffer),
    )
    const wrapped =
      matchIndex >= 0
        ? matchIndex
        : flat.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(state.buffer))
    if (wrapped < 0) return

    if (open) {
      setActiveIndex(wrapped)
    } else {
      selectValue(flat[wrapped]!.value)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'Tab') {
      if (open) closeMenu(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openMenu(findEnabledIndex(flat, currentValue))
      else setActiveIndex((idx) => stepEnabled(flat, idx, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) openMenu(findEnabledIndex(flat, currentValue))
      else setActiveIndex((idx) => stepEnabled(flat, idx, -1))
      return
    }
    if (e.key === 'Home') {
      if (!open) return
      e.preventDefault()
      const first = firstEnabled(flat)
      if (first >= 0) setActiveIndex(first)
      return
    }
    if (e.key === 'End') {
      if (!open) return
      e.preventDefault()
      const last = lastEnabled(flat)
      if (last >= 0) setActiveIndex(last)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        openMenu(findEnabledIndex(flat, currentValue))
      } else {
        const picked = flat[activeIndex]
        if (picked && !picked.disabled) selectValue(picked.value)
        else closeMenu(true)
      }
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      handleTypeahead(e.key)
    }
  }

  const renderOption = (opt: ParsedOption) => {
    const isSelected = opt.value === currentValue
    const isActive = open && opt.index === activeIndex
    const optId = `${listboxId}-opt-${opt.index}`
    return (
      <div
        key={`${opt.index}:${opt.value}`}
        ref={(el) => {
          optionRefs.current[opt.index] = el
        }}
        id={optId}
        role="option"
        aria-selected={isSelected}
        aria-disabled={opt.disabled || undefined}
        data-active={isActive ? 'true' : undefined}
        className={[
          styles.option,
          isSelected ? styles.optionSelected : '',
          isActive ? styles.optionActive : '',
          opt.disabled ? styles.optionDisabled : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseMove={() => {
          if (!opt.disabled && activeIndex !== opt.index) setActiveIndex(opt.index)
        }}
        onMouseDown={(e) => {
          e.preventDefault()
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!opt.disabled) selectValue(opt.value)
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.check}
        >
          <path d="M2.2 6.3 4.8 9l5-5.8" />
        </svg>
        <span className={styles.optionLabel}>{opt.label}</span>
      </div>
    )
  }

  const activeOption = open && activeIndex >= 0 ? flat[activeIndex] : undefined
  const activeOptionId = activeOption ? `${listboxId}-opt-${activeOption.index}` : undefined

  const control = (
    <div
      data-openaxe-select=""
      className={label ? styles.control : `${styles.root} ${className ?? ''}`.trim()}
      style={label ? undefined : style}
    >
      <button
        ref={triggerRef}
        type="button"
        id={selectId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        title={title}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        style={supportsAnchorPositioning() ? ({ anchorName } as CSSProperties) : undefined}
        className={styles.trigger}
        onPointerDown={(e) => {
          if (disabled) return
          const isOpenNow = open || (nativePopover && listboxRef.current?.matches(':popover-open'))
          if (isOpenNow) {
            e.preventDefault()
            suppressNextClickRef.current = true
            closeMenu(true)
          }
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false
            return
          }
          if (open) closeMenu(true)
          else openMenu()
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.valueText}>{selectedOption?.label ?? ''}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.chevron}
        >
          <path d="M2.5 4.25 6 7.75l3.5-3.5" />
        </svg>
      </button>

      {name && <input type="hidden" name={name} value={currentValue} disabled={disabled} />}

      <div
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-label="Options"
        popover={nativePopover ? 'auto' : undefined}
        hidden={!nativePopover && !open}
        data-open={open ? 'true' : undefined}
        style={
          supportsAnchorPositioning()
            ? ({ positionAnchor: anchorName } as CSSProperties)
            : undefined
        }
        className={`${styles.listbox} ${!nativePopover ? styles.listboxFallback : ''}`.trim()}
        onClick={(e) => {
          // Guard against enclosing <label> wrappers re-activating the trigger on clicks inside padding/groups.
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {open &&
          nodes.map((node, i) => {
            if (node.kind === 'option') return renderOption(node)
            const groupLabelId = `${listboxId}-grp-${i}`
            return (
              <div
                key={`${i}:${node.label}`}
                role="group"
                aria-labelledby={groupLabelId}
                className={styles.group}
              >
                <div id={groupLabelId} className={styles.groupLabel}>
                  {node.label}
                </div>
                {node.options.map(renderOption)}
              </div>
            )
          })}
      </div>
    </div>
  )

  if (label) {
    return (
      <div className={`${styles.field} ${className ?? ''}`.trim()} style={style}>
        <label htmlFor={selectId} className={styles.label}>
          {label}
        </label>
        {control}
      </div>
    )
  }

  return control
}
