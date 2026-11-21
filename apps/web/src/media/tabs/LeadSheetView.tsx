/**
 * Chord chart / lead sheet view (issue #459): sections of bars with chords
 * over lyrics, the playing bar lit and kept in view; transpose and text size
 * for a music stand. Click a bar to play from there.
 */
import { HardwareButton } from '@openaxe/ui'
import { useEffect, useRef } from 'react'

import styles from '../MediaCenter.module.css'
import { type ChartSection, transposeChord } from './leadSheet'
import t from './TabWorkspace.module.css'

interface LeadSheetViewProps {
  title: string
  sections: ChartSection[]
  currentBar: number
  transpose: number
  onTranspose: (semitones: number) => void
  size: number
  onSize: (size: number) => void
  onBar: (index: number) => void
}

export function LeadSheetView({
  title,
  sections,
  currentBar,
  transpose,
  onTranspose,
  size,
  onSize,
  onBar,
}: LeadSheetViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current
      ?.querySelector(`[data-bar="${currentBar}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentBar])
  const anyChords = sections.some((s) => s.bars.some((b) => b.chords.length))
  const anyLyrics = sections.some((s) => s.bars.some((b) => b.lyrics))
  return (
    <div className={t.lead} ref={ref} style={{ fontSize: `${size}px` }}>
      <div className={t.leadBar}>
        <strong>{title}</strong>
        <span className={t.footerSpacer} />
        <span className={styles.dim}>transpose</span>
        <HardwareButton size="small" label="−" onClick={() => onTranspose(transpose - 1)} />
        <span className={t.leadValue}>{transpose > 0 ? `+${transpose}` : transpose}</span>
        <HardwareButton size="small" label="+" onClick={() => onTranspose(transpose + 1)} />
        <span className={styles.dim}>size</span>
        <HardwareButton size="small" label="A−" onClick={() => onSize(Math.max(12, size - 2))} />
        <HardwareButton size="small" label="A+" onClick={() => onSize(Math.min(40, size + 2))} />
      </div>
      {!anyChords && !anyLyrics && (
        <p className={t.hint}>
          This song has no chord names or lyrics yet. Add them in edit mode (Text &amp; chords
          tools, or the chord library) and they appear here.
        </p>
      )}
      {sections.map((s, si) => (
        <section key={si} className={t.leadSection}>
          {s.label && <h3>{s.label}</h3>}
          <div className={t.leadBars}>
            {s.bars.map((b) => (
              <button
                key={b.index}
                type="button"
                data-bar={b.index}
                className={`${t.leadCell} ${b.index === currentBar ? t.leadCellOn : ''}`}
                onClick={() => onBar(b.index)}
                title={`Bar ${b.index + 1} — play from here`}
              >
                {b.repeatStart && (
                  <span className={t.leadRepeat} style={{ left: '0.3em', right: 'auto' }}>
                    𝄆
                  </span>
                )}
                <span className={t.leadChords}>
                  {b.chords.length === 0 ? (
                    <span className={styles.dim}>/</span>
                  ) : (
                    b.chords.map((c, i) => (
                      <span key={i} style={{ left: `${c.at * 100}%` }}>
                        {transposeChord(c.name, transpose)}
                      </span>
                    ))
                  )}
                </span>
                {anyLyrics && <span className={t.leadLyrics}>{b.lyrics || ' '}</span>}
                {b.repeatEnd > 0 && (
                  <span className={t.leadRepeat}>𝄇{b.repeatEnd > 2 ? ` ×${b.repeatEnd}` : ''}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
