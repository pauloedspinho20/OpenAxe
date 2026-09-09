import styles from './Meter.module.css'

const SEGMENT_COUNT = 12
/** Segments in the top ~25%/~8% turn amber/red - the classic VU "danger zone" near clipping. */
const AMBER_FROM = 0.75
const RED_FROM = 0.92

/** Silence floor for the peak-dB readout: nothing quieter than this is worth printing. */
const PEAK_FLOOR_DB = -60

/**
 * A peak level (0..1) rendered as dBFS for the peak-hold readout: 1 → "0.0 dB",
 * floored at `PEAK_FLOOR_DB` so silence reads as a number rather than -inf.
 * Pure and exported so callers can compute the same string the meter shows.
 */
export function levelToPeakDb(level: number): string {
  if (level <= 0) return '−∞'
  const floored = Math.max(20 * Math.log10(level), PEAK_FLOOR_DB)
  return `${floored.toFixed(1).replace('-', '−')}`
}

export type MeterVariant = 'level' | 'gainReduction'

export interface MiniMeterProps {
  /** Signal level in [0, 1], 1 = clipping. */
  level: number
  title?: string | undefined
  /** When 'gainReduction', the fill is always red regardless of level. */
  variant?: MeterVariant
  /** Optional value readout (e.g. a peak in dB, or a live gain-reduction value) rendered above a vertical meter. MiniMeter ignores it. */
  valueLabel?: string
  /** Optional caption rendered below a vertical meter (e.g. "IN"/"OUT"). MiniMeter ignores it. */
  label?: string
}

/** A single-bar meter for tight spaces (e.g. a grid block card). The bar shows a fixed green→amber→red gradient, revealed by the level. */
export function MiniMeter({ level, title, variant = 'level' }: MiniMeterProps) {
  const clamped = Math.min(1, Math.max(0, level))
  const gainReduction = variant === 'gainReduction'
  return (
    <span className={styles.miniWrap} title={title}>
      <span
        className={`${styles.miniFill} ${gainReduction ? styles.gainReduction : styles.gradient}`}
        style={{ clipPath: `inset(0 ${(1 - clamped) * 100}% 0 0)` }}
      />
    </span>
  )
}

/** A single-bar medium meter for tight spaces (e.g. the Block Inspector). The bar shows a fixed green→amber→red gradient, revealed by the level. */
export function MediumMeter({
  level,
  title,
  variant = 'level',
  valueLabel,
  label,
}: MiniMeterProps) {
  const clamped = Math.min(1, Math.max(0, level))
  const gainReduction = variant === 'gainReduction'
  return (
    <span className={styles.mediumGroup} title={title}>
      {valueLabel !== undefined && <span className={styles.peakLabel}>{valueLabel}</span>}
      <span className={styles.mediumWrap}>
        <span
          className={`${styles.mediumFill} ${gainReduction ? styles.gainReduction : styles.gradient}`}
          style={{ clipPath: `inset(${(1 - clamped) * 100}% 0 0 0)` }}
        />
      </span>
      {label !== undefined && <span className={styles.meterLabel}>{label}</span>}
    </span>
  )
}

export interface MeterProps {
  label?: string
  /** Signal level in [0, 1], 1 = clipping. */
  level: number
  /** Optional value readout (e.g. a peak in dB) rendered above the segments. */
  valueLabel?: string
}

/** A segmented VU-style level meter. Presentational - the caller supplies the level. */
export function Meter({ label, level, valueLabel }: MeterProps) {
  return (
    <div className={styles.wrap}>
      {valueLabel !== undefined && <span className={styles.peakLabel}>{valueLabel}</span>}
      <div className={styles.segments}>{renderSegments(level)}</div>
      {label && <span className="label">{label}</span>}
    </div>
  )
}

export interface StereoMeterProps {
  /** Group label rendered below the pair (e.g. "Output"). Each side always shows its own L/R caption. */
  label?: string
  /** Left signal level in [0, 1], 1 = clipping. */
  levelL: number
  /** Right signal level in [0, 1], 1 = clipping. */
  levelR: number
  /** Optional peak readouts rendered above each side. */
  valueLabelL?: string
  valueLabelR?: string
  title?: string | undefined
}

/**
 * A slim stereo variant of the segmented VU meter: two narrow 12-segment
 * columns side by side (L/R), fitting roughly the width of one large `Meter`
 * so a rail can show true per-channel levels without growing. Presentational -
 * the caller supplies both levels.
 */
export function StereoMeter({
  label,
  levelL,
  levelR,
  valueLabelL,
  valueLabelR,
  title,
}: StereoMeterProps) {
  return (
    <div className={styles.stereoWrap} title={title}>
      <div className={styles.peakLabels}>
        {valueLabelL !== undefined && <span className={styles.peakLabel}>{valueLabelL}</span>}
        {valueLabelR !== undefined && <span className={styles.peakLabel}>{valueLabelR}</span>}
      </div>
      <div className={styles.stereoPair}>
        <div className={styles.slimCol}>
          <div className={styles.slimSegments}>{renderSegments(levelL, true)}</div>
          <span className={styles.slimCaption}>L</span>
        </div>
        <div className={styles.slimCol}>
          <div className={styles.slimSegments}>{renderSegments(levelR, true)}</div>
          <span className={styles.slimCaption}>R</span>
        </div>
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  )
}

/** The 12 VU segments for a level in [0, 1]; slim renders the narrow stereo-column style. */
function renderSegments(level: number, slim = false) {
  const clamped = Math.min(1, Math.max(0, level))
  const litCount = Math.round(clamped * SEGMENT_COUNT)
  return Array.from({ length: SEGMENT_COUNT }, (_, i) => {
    const index = SEGMENT_COUNT - 1 - i
    const threshold = (index + 1) / SEGMENT_COUNT
    const lit = index < litCount
    const color =
      threshold > RED_FROM ? 'statusRed' : threshold > AMBER_FROM ? 'statusAmber' : 'statusGreen'
    return (
      <span
        key={index}
        className={`${slim ? styles.slimSegment : styles.segment} ${lit ? styles.lit : ''} ${styles[color]}`}
      />
    )
  })
}
