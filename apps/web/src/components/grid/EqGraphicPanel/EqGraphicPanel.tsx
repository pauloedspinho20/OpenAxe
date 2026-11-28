import { Fader } from '@openaxe/ui'
import { EQ_GRAPHIC_BANDS } from '../../../effects/paramSchema'
import { graphicResponseDb } from '../../../effects/eqResponse'
import type { EffectParams } from '../../../engine/blocks/Block'
import styles from './EqGraphicPanel.module.css'

interface Props {
  values: EffectParams
  setParam: (key: string, value: number) => void
}

const W = 600
const H = 110
const MIN_HZ = 20
const MAX_HZ = 20000
const RANGE_DB = 15

const xOf = (hz: number) => (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * W
const yOf = (db: number) => H / 2 - (db / RANGE_DB) * (H / 2)
const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

/** Ten octave faders over the EQ's live response curve (graphic mode). */
export function EqGraphicPanel({ values, setParam }: Props) {
  const gains = EQ_GRAPHIC_BANDS.map((b) => num(values[b.key]))

  const points: string[] = []
  for (let i = 0; i <= 160; i++) {
    const hz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (i / 160)
    points.push(`${xOf(hz).toFixed(1)},${yOf(graphicResponseDb(gains, hz)).toFixed(1)}`)
  }

  return (
    <div className={styles.panel}>
      <svg
        className={styles.curve}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="EQ frequency response"
      >
        {[-10, -5, 0, 5, 10].map((db) => (
          <line
            key={db}
            x1={0}
            x2={W}
            y1={yOf(db)}
            y2={yOf(db)}
            className={db === 0 ? styles.zero : styles.grid}
          />
        ))}
        {EQ_GRAPHIC_BANDS.map((b) => (
          <line key={b.key} x1={xOf(b.hz)} x2={xOf(b.hz)} y1={0} y2={H} className={styles.grid} />
        ))}
        <polyline points={points.join(' ')} className={styles.line} />
      </svg>
      <div className={styles.faders}>
        {EQ_GRAPHIC_BANDS.map((b, i) => (
          <Fader
            key={b.key}
            label={b.label}
            value={gains[i] ?? 0}
            min={-12}
            max={12}
            step={0.5}
            snapTo={0}
            length={80}
            valueDisplay="tooltip"
            formatValue={fmtDb}
            onChange={(v) => setParam(b.key, v)}
          />
        ))}
      </div>
      <button
        type="button"
        className={styles.flatten}
        onClick={() => {
          for (const b of EQ_GRAPHIC_BANDS) setParam(b.key, 0)
        }}
      >
        Flatten
      </button>
    </div>
  )
}
