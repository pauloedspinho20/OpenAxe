import { useCallback, useId, useRef, useState } from 'react'
import styles from './Knob.module.css'

const MIN_ANGLE = -135
const MAX_ANGLE = 135
const SWEEP = MAX_ANGLE - MIN_ANGLE
const RADIUS = 34
const CENTER = 40
const DRAG_RANGE_PX = 150

export interface KnobProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  defaultValue?: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
  size?: number
  disabled?: boolean
  /** Human-readable param help — rendered as native tooltip (title) and aria-describedby. */
  description?: string | undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function polarPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER + radius * Math.sin(angleRad),
  }
}

function describeArc(startAngle: number, endAngle: number, radius: number): string {
  if (endAngle <= startAngle) return ''
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  const start = polarPoint(startAngle, radius)
  const end = polarPoint(endAngle, radius)
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

/**
 * A rotary control, drag-vertically to turn (the standard hardware/DAW knob
 * gesture - not drag-in-a-circle, which is awkward with a mouse). Hold Shift
 * while dragging for finer control. Double-click resets to defaultValue.
 */
export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  defaultValue,
  onChange,
  formatValue,
  size = 56,
  disabled = false,
  description,
}: KnobProps) {
  const id = useId()
  const descId = useId()
  const dragState = useRef<{ startY: number; startValue: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const normalized = clamp((value - min) / (max - min), 0, 1)
  const angle = MIN_ANGLE + normalized * SWEEP

  const commit = useCallback(
    (next: number) => onChange(clamp(Math.round(next / step) * step, min, max)),
    [onChange, min, max, step],
  )

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { startY: event.clientY, startValue: value }
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current
    if (!drag) return
    const fine = event.shiftKey
    const range = fine ? DRAG_RANGE_PX * 4 : DRAG_RANGE_PX
    const deltaY = drag.startY - event.clientY
    const deltaValue = (deltaY / range) * (max - min)
    commit(drag.startValue + deltaValue)
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragState.current = null
    setDragging(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return
    const bigStep = (max - min) / 20
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        event.preventDefault()
        commit(value + step)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        event.preventDefault()
        commit(value - step)
        break
      case 'PageUp':
        event.preventDefault()
        commit(value + bigStep)
        break
      case 'PageDown':
        event.preventDefault()
        commit(value - bigStep)
        break
      case 'Home':
        event.preventDefault()
        commit(min)
        break
      case 'End':
        event.preventDefault()
        commit(max)
        break
    }
  }

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return
    commit(defaultValue)
  }

  return (
    <div
      className={styles.wrap}
      style={{ width: size }}
      title={description}
      aria-describedby={description ? descId : undefined}
    >
      {formatValue && <span className={styles.value}>{formatValue(value)}</span>}
      <svg
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        aria-labelledby={id}
        viewBox="0 0 80 80"
        width={size}
        height={size}
        className={`${styles.knob} ${dragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <radialGradient id={`${id}-body`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#333331" />
            <stop offset="55%" stopColor="#222220" />
            <stop offset="100%" stopColor="#141412" />
          </radialGradient>
        </defs>
        <path className={styles.track} d={describeArc(MIN_ANGLE, MAX_ANGLE, RADIUS)} fill="none" />
        <path className={styles.fill} d={describeArc(MIN_ANGLE, angle, RADIUS)} fill="none" />
        <circle
          className={styles.body}
          cx={CENTER}
          cy={CENTER}
          r={RADIUS - 8}
          fill={`url(#${id}-body)`}
        />
        <line
          className={styles.pointer}
          x1={polarPoint(angle, 8).x}
          y1={polarPoint(angle, 8).y}
          x2={polarPoint(angle, RADIUS - 11).x}
          y2={polarPoint(angle, RADIUS - 11).y}
        />
      </svg>
      <span id={id} className={`label ${styles.label}`}>
        {label}
      </span>
      {description && (
        <span id={descId} style={{ display: 'none' }}>
          {description}
        </span>
      )}
    </div>
  )
}
