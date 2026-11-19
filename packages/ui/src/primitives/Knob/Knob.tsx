import { useCallback, useId, useRef, useState } from 'react'
import styles from './Knob.module.css'

const MIN_ANGLE = -135
const MAX_ANGLE = 135
const SWEEP = MAX_ANGLE - MIN_ANGLE
const CENTER = 50
const DRAG_RANGE_PX = 150

// Geometry of the analog knob (viewBox 100x100): a printed 0-10 scale on the
// panel, a black skirted knob with a knurled edge and a white index line, and
// a brushed-metal cap. The skirt rotates; the cap's lighting stays fixed, as a
// real light source would.
const SCALE_INNER = 38
const SCALE_OUTER = 42
const SCALE_MAJOR_OUTER = 44
const NUMERAL_RADIUS = 47.5
const SKIRT = 33
const KNURL_INNER = 29.8
const KNURL_COUNT = 40
const CAP = 24
const TICKS = 11 // 0..10
/** Numerals are only legible on knobs at least this big (px). */
const NUMERALS_MIN_SIZE = 60

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
  /**
   * Right-click handler for the whole knob (label included) - the web app
   * uses it to open a MIDI-mapping context menu. Kept as a plain passthrough
   * so this shared primitive never learns about MIDI stores.
   */
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  /**
   * Tints the knob base with the accent color - the web app sets it while
   * this param is armed for MIDI learn, so the listening knob is visible
   * across the panel. Purely presentational.
   */
  highlighted?: boolean
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
  onContextMenu,
  highlighted = false,
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
      onContextMenu={onContextMenu}
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
        aria-describedby={description ? descId : undefined}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={`${styles.knob} ${dragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''} ${highlighted ? styles.highlighted : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <radialGradient id={`${id}-skirt`} cx="40%" cy="32%" r="80%">
            <stop offset="0%" stopColor="#2c2c2a" />
            <stop offset="60%" stopColor="#161615" />
            <stop offset="100%" stopColor="#090909" />
          </radialGradient>
          <linearGradient id={`${id}-cap`} x1="20%" y1="10%" x2="80%" y2="95%">
            <stop offset="0%" stopColor="#e4e3de" />
            <stop offset="45%" stopColor="#a7a6a1" />
            <stop offset="100%" stopColor="#5c5b57" />
          </linearGradient>
          <radialGradient id={`${id}-shine`} cx="34%" cy="28%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>

        {/* Printed scale: ticks up to the value glow like a lit panel. */}
        <g className={styles.scale}>
          {Array.from({ length: TICKS }, (_, i) => {
            const t = i / (TICKS - 1)
            const a = MIN_ANGLE + t * SWEEP
            const major = i % 5 === 0
            const p1 = polarPoint(a, SCALE_INNER)
            const p2 = polarPoint(a, major ? SCALE_MAJOR_OUTER : SCALE_OUTER)
            return (
              <line
                key={i}
                className={`${styles.tick} ${t <= normalized + 1e-6 ? styles.tickLit : ''} ${major ? styles.tickMajor : ''}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
              />
            )
          })}
          {size >= NUMERALS_MIN_SIZE &&
            [0, 2, 4, 6, 8, 10].map((n) => {
              const p = polarPoint(MIN_ANGLE + (n / 10) * SWEEP, NUMERAL_RADIUS)
              return (
                <text
                  key={n}
                  className={styles.numeral}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {n}
                </text>
              )
            })}
        </g>

        {/* Cast shadow, offset down-right from a fixed light. */}
        <circle
          className={styles.shadow}
          cx={CENTER + 1.5}
          cy={CENTER + 3.5}
          r={SKIRT}
          filter={`url(#${id}-shadow)`}
        />

        {/* Skirt: rotates with the value, knurling and index line included. */}
        <g transform={`rotate(${angle} ${CENTER} ${CENTER})`}>
          <circle
            className={styles.body}
            cx={CENTER}
            cy={CENTER}
            r={SKIRT}
            fill={`url(#${id}-skirt)`}
          />
          {Array.from({ length: KNURL_COUNT }, (_, i) => {
            const a = (i / KNURL_COUNT) * 360
            const p1 = polarPoint(a, KNURL_INNER)
            const p2 = polarPoint(a, SKIRT - 0.6)
            return <line key={i} className={styles.knurl} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
          })}
          <line
            className={styles.index}
            x1={CENTER}
            y1={CENTER - CAP - 1}
            x2={CENTER}
            y2={CENTER - SKIRT + 1.5}
          />
        </g>
        {highlighted && (
          <circle
            data-part="accent-wash"
            className={styles.accentWash}
            cx={CENTER}
            cy={CENTER}
            r={SKIRT}
          />
        )}

        {/* Skirt rim catching the light (fixed, upper left). */}
        <circle className={styles.rimLight} cx={CENTER} cy={CENTER} r={SKIRT - 0.5} />

        {/* Brushed-metal cap: fixed lighting, rotating pointer. */}
        <circle className={styles.capBevel} cx={CENTER} cy={CENTER} r={CAP + 1.6} />
        <circle cx={CENTER} cy={CENTER} r={CAP} fill={`url(#${id}-cap)`} />
        {[0.82, 0.62, 0.42].map((k) => (
          <circle key={k} className={styles.brush} cx={CENTER} cy={CENTER} r={CAP * k} />
        ))}
        <circle cx={CENTER} cy={CENTER} r={CAP} fill={`url(#${id}-shine)`} />
        <line
          className={styles.pointer}
          x1={polarPoint(angle, 5).x}
          y1={polarPoint(angle, 5).y}
          x2={polarPoint(angle, CAP - 3).x}
          y2={polarPoint(angle, CAP - 3).y}
        />
        <circle className={styles.focusRing} cx={CENTER} cy={CENTER} r={SKIRT + 3} />
      </svg>
      <span id={id} className={`label ${styles.label}`}>
        {label}
      </span>
      {description && (
        <span id={descId} className={styles.srOnly}>
          {description}
        </span>
      )}
    </div>
  )
}
