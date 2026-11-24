import { useEffect, useRef, useState } from 'react'

import { FEATURES, type AudioFeatures, type FeatureGroup } from '../audio/features'
import { noteName } from './format'
import styles from './Visuals.module.css'

const GROUP_LABEL: Record<FeatureGroup, string> = {
  volume: 'Volume',
  pitch: 'Pitch',
  timbre: 'Timbre',
}
const GROUPS: FeatureGroup[] = ['volume', 'pitch', 'timbre']

/**
 * Live debug meters for every feature. Bars are written straight to the DOM
 * from a rAF loop (no React state per frame); the note readout re-renders at
 * most ~10x a second.
 */
export function FeatureMeters({ features }: { features: Readonly<AudioFeatures> | null }) {
  const barRefs = useRef(new Map<string, HTMLSpanElement>())
  const [readout, setReadout] = useState({ note: -1, hz: 0, cents: 0, db: -120 })

  useEffect(() => {
    if (!features) return
    let raf = 0
    let tick = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      for (const f of FEATURES) {
        const el = barRefs.current.get(f.id)
        if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, features[f.id]))})`
      }
      if (++tick % 6 === 0) {
        setReadout((prev) => {
          const next = {
            note: features.note,
            hz: Math.round(features.hz * 10) / 10,
            cents: Math.round(features.cents),
            db: Math.round(features.levelDb),
          }
          return prev.note === next.note && prev.hz === next.hz && prev.db === next.db ? prev : next
        })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [features])

  return (
    <div className={styles.meters} data-testid="feature-meters">
      <div className={styles.readout}>
        <span className={styles.readoutNote}>{noteName(readout.note)}</span>
        <span>
          {readout.note >= 0
            ? `${readout.hz} Hz · ${readout.cents > 0 ? '+' : ''}${readout.cents}¢`
            : 'no pitch'}
        </span>
        <span>{readout.db > -119 ? `${readout.db} dBFS` : 'silent'}</span>
      </div>
      {GROUPS.map((group) => (
        <div key={group} className={styles.meterGroup}>
          <span className={styles.meterGroupLabel}>{GROUP_LABEL[group]}</span>
          {FEATURES.filter((f) => f.group === group).map((f) => (
            <div key={f.id} className={styles.meterRow} title={f.description}>
              <span className={styles.meterLabel}>{f.label}</span>
              <span className={styles.meterTrack}>
                <span
                  className={`${styles.meterFill} ${f.impulse ? styles.meterImpulse : ''}`}
                  ref={(el) => {
                    if (el) barRefs.current.set(f.id, el)
                    else barRefs.current.delete(f.id)
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
