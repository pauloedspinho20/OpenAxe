/**
 * Practice report (issue #205 practice toolkit): the last scored run, the best
 * clean speed, the bars to work on, the heat-map toggle and a progress chart
 * of accuracy and speed across runs.
 */
import { HardwareButton } from '@openaxe/ui'
import { useMemo } from 'react'

import styles from '../MediaCenter.module.css'
import type { PracticeRun } from '../mediaDb'
import { barHeat, bestCleanSpeed, runAccuracy, worstBars, worstSpan } from './practiceScore'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'

interface PracticePanelProps {
  runs: PracticeRun[]
  heatOn: boolean
  onHeat: (on: boolean) => void
  onLoopBars: (from: number, to: number) => void
  onClear: () => void
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Chart({ runs }: { runs: PracticeRun[] }) {
  const recent = runs.slice(-30)
  if (recent.length < 2)
    return <p className={t.hint}>Your progress chart appears after two scored runs.</p>
  const W = 260
  const H = 70
  const x = (i: number) => (i / (recent.length - 1)) * (W - 8) + 4
  const yAcc = (v: number) => H - 4 - v * (H - 8)
  const maxSpeed = Math.max(1, ...recent.map((r) => r.speed))
  const ySpeed = (v: number) => H - 4 - (v / maxSpeed) * (H - 8)
  const line = (f: (r: PracticeRun) => number) =>
    recent.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${f(r).toFixed(1)}`).join(' ')
  return (
    <figure className={t.chart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Accuracy and speed over recent runs"
      >
        <line x1="4" x2={W - 4} y1={yAcc(0.9)} y2={yAcc(0.9)} className={t.chartGuide} />
        <path d={line((r) => ySpeed(r.speed))} className={t.chartSpeed} />
        <path d={line((r) => yAcc(runAccuracy(r)))} className={t.chartAcc} />
        {recent.map((r, i) => (
          <circle key={i} cx={x(i)} cy={yAcc(runAccuracy(r))} r={2} className={t.chartDot}>
            <title>{`${new Date(r.at).toLocaleString()} — ${pct(runAccuracy(r))} at ${pct(r.speed)} speed (${r.mode})`}</title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <span className={t.legendAcc}>accuracy</span> <span className={t.legendSpeed}>speed</span>{' '}
        <span className={styles.dim}>· dashed = 90%</span>
      </figcaption>
    </figure>
  )
}

export function PracticePanel({ runs, heatOn, onHeat, onLoopBars, onClear }: PracticePanelProps) {
  const last = runs[runs.length - 1]
  const heat = useMemo(() => barHeat(runs), [runs])
  const span = worstSpan(worstBars(heat))
  const best = bestCleanSpeed(runs)
  return (
    <details className={t.sideSection} open={runs.length > 0}>
      <summary>
        <I.WaitIcon size={14} /> Practice report
        {last && <span className={t.sideBadge}>{pct(runAccuracy(last))}</span>}
      </summary>
      <div className={t.recPanel}>
        {!last ? (
          <p className={t.hint}>
            Turn on <strong>Listen</strong> (scores you while the song plays) or{' '}
            <strong>Wait</strong> mode (waits for each note), then play along. Your runs, weak bars
            and progress show up here.
          </p>
        ) : (
          <>
            <div className={t.reportRow}>
              <strong className={t.bigNumber}>{pct(runAccuracy(last))}</strong>
              <span className={styles.dim}>
                last run · {last.hits}/{last.notes} notes · {pct(last.speed)} speed · {last.mode}
              </span>
            </div>
            <div className={t.reportRow}>
              <span>Best clean speed (≥90%):</span>
              <strong>{best === null ? '—' : pct(best)}</strong>
            </div>
            <div className={t.tapRow}>
              <HardwareButton
                size="small"
                label={
                  span
                    ? `Loop bar${span[0] === span[1] ? '' : 's'} ${span[0] + 1}${span[0] === span[1] ? '' : `–${span[1] + 1}`}`
                    : 'No weak bars'
                }
                title="Loop the bars you miss most (from the last 5 runs)"
                icon={<I.LoopIcon size={14} />}
                disabled={!span}
                onClick={() => span && onLoopBars(span[0], span[1])}
              />
              <HardwareButton
                size="small"
                label="Heat map"
                title="Colour bars by accuracy on the sheet"
                active={heatOn}
                onClick={() => onHeat(!heatOn)}
              />
            </div>
            <Chart runs={runs} />
            <div className={t.tapRow}>
              <span className={styles.dim}>{runs.length} runs saved</span>
              <HardwareButton
                size="small"
                label="Clear"
                variant="danger"
                onClick={() => {
                  if (confirm('Clear the practice history for this song?')) onClear()
                }}
              />
            </div>
          </>
        )}
      </div>
    </details>
  )
}
