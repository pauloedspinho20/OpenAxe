import styles from './Meter.module.css'

const SEGMENT_COUNT = 12
/** Segments in the top ~25%/~8% turn amber/red - the classic VU "danger zone" near clipping. */
const AMBER_FROM = 0.75
const RED_FROM = 0.92

function levelColor(level: number): 'statusGreen' | 'statusAmber' | 'statusRed' {
  return level > RED_FROM ? 'statusRed' : level > AMBER_FROM ? 'statusAmber' : 'statusGreen'
}

export type MeterVariant = 'level' | 'gainReduction'

export interface MiniMeterProps {
  /** Signal level in [0, 1], 1 = clipping. */
  level: number
  title?: string | undefined
  /** When 'gainReduction', the fill is always red regardless of level. */
  variant?: MeterVariant
}

/** A single-bar meter for tight spaces (e.g. a grid block card) - same colour thresholds as Meter. */
export function MiniMeter({ level, title, variant = 'level' }: MiniMeterProps) {
  const clamped = Math.min(1, Math.max(0, level))
  const color = variant === 'gainReduction' ? 'statusRed' : levelColor(clamped)
  return (
    <span className={styles.miniWrap} title={title}>
      <span
        className={`${styles.miniFill} ${styles[color]}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </span>
  )
}

/** A single-bar medium meter for tight spaces (e.g. the Block Inspector) - same colour thresholds as Meter. */
export function MediumMeter({ level, title, variant = 'level' }: MiniMeterProps) {
  const clamped = Math.min(1, Math.max(0, level))
  const color = variant === 'gainReduction' ? 'statusRed' : levelColor(clamped)
  return (
    <span className={styles.mediumWrap} title={title}>
      <span
        className={`${styles.mediumFill} ${styles[color]}`}
        style={{ height: `${clamped * 100}%` }}
      />
    </span>
  )
}

export interface MeterProps {
  label?: string
  /** Signal level in [0, 1], 1 = clipping. */
  level: number
}

/** A segmented VU-style level meter. Presentational - the caller supplies the level. */
export function Meter({ label, level }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, level))
  const litCount = Math.round(clamped * SEGMENT_COUNT)

  return (
    <div className={styles.wrap}>
      <div className={styles.segments}>
        {Array.from({ length: SEGMENT_COUNT }, (_, i) => {
          const index = SEGMENT_COUNT - 1 - i
          const threshold = (index + 1) / SEGMENT_COUNT
          const lit = index < litCount
          const color =
            threshold > RED_FROM
              ? 'statusRed'
              : threshold > AMBER_FROM
                ? 'statusAmber'
                : 'statusGreen'
          return (
            <span
              key={index}
              className={`${styles.segment} ${lit ? styles.lit : ''} ${styles[color]}`}
            />
          )
        })}
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  )
}
