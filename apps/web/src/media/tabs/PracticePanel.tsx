/**
 * Practice report (issue #205 practice toolkit): the last scored run, the best
 * clean speed, the bars to work on, the heat-map toggle and a progress chart
 * of accuracy and speed across runs.
 */
import { HardwareButton } from '@openaxe/ui'
import { useMemo, useState } from 'react'

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
  /** Label of the section the routine is on, or null when it isn't running. */
  routine: string | null
  routineDone: boolean
  onStartRoutine: (startSpeed: number, targetSpeed: number) => void
  onStopRoutine: () => void
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

function RoutineControls({
  routine,
  routineDone,
  onStartRoutine,
  onStopRoutine,
}: Pick<PracticePanelProps, 'routine' | 'routineDone' | 'onStartRoutine' | 'onStopRoutine'>) {
  const [start, setStart] = useState(0.7)
  return (
    <div className={t.routineBox}>
      <strong>Practice section by section</strong>
      {routine ? (
        <div className={t.tapRow}>
          <span>On {routine}</span>
          <HardwareButton size="small" label="Stop" variant="danger" onClick={onStopRoutine} />
        </div>
      ) : (
        <>
          <p className={t.hint}>
            Loops each section with Listen on, speeding up 5% after every clean pass from your start
            speed to 100%, then moves to the next section.
            {routineDone && ' Last routine: complete ✓'}
          </p>
          <div className={t.tapRow}>
            <label className={t.textField}>
              <span className={styles.dim}>from</span>
              <select
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
                aria-label="Routine start speed"
              >
                {[0.5, 0.6, 0.7, 0.8, 0.9].map((v) => (
                  <option key={v} value={v}>
                    {pct(v)}
                  </option>
                ))}
              </select>
            </label>
            <HardwareButton
              size="small"
              label="Start routine"
              icon={<I.LoopIcon size={14} />}
              onClick={() => onStartRoutine(start, 1)}
            />
          </div>
        </>
      )}
    </div>
  )
}

export function PracticePanel({
  runs,
  heatOn,
  onHeat,
  onLoopBars,
  onClear,
  routine,
  routineDone,
  onStartRoutine,
  onStopRoutine,
}: PracticePanelProps) {
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
        <RoutineControls
          routine={routine}
          routineDone={routineDone}
          onStartRoutine={onStartRoutine}
          onStopRoutine={onStopRoutine}
        />
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
