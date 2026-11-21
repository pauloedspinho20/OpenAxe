/**
 * Pair a recording of the song with the tab and line them up (issue #205
 * practice toolkit). Play the recording and tap at the start of each bar; the
 * taps become sync points, so the tab cursor, bar loops, count-in and wait
 * mode follow the real song - tempo drift included.
 */
import { HardwareButton, Select } from '@openaxe/ui'

import { formatTime } from '../decode'
import styles from '../MediaCenter.module.css'
import type { MediaItem } from '../mediaDb'
import type { RecordingSync } from './sync'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'

interface RecordingPanelProps {
  recordings: MediaItem[]
  sync: RecordingSync | null
  source: 'synth' | 'recording'
  tapBar: number
  barCount: number
  /** Bar index whose start a score time is (for listing points). */
  barOf: (scoreSec: number) => number
  onPair: (audioId: string | null) => void
  onSource: (source: 'synth' | 'recording') => void
  onTapBar: (bar: number) => void
  onTap: () => void
  /** Guide level (0 = off) and the track it plays. */
  guide: number
  guideTrack: string
  onGuide: (level: number) => void
  onRemovePoint: (index: number) => void
  onClear: () => void
  onNudge: (seconds: number) => void
  /** Render the panel content directly without a collapsible `<details>` wrapper. */
  bare?: boolean
}

export function RecordingPanel(p: RecordingPanelProps) {
  const points = p.sync?.points ?? []
  const paired = p.recordings.find((r) => r.id === p.sync?.audioId)
  const body = (
    <div className={t.recPanel}>
      <label className={t.textField} title="A recording of this song from your library">
        <I.NoteGlyphIcon size={14} />
        <Select
          value={p.sync?.audioId ?? ''}
          onChange={(e) => p.onPair(e.target.value || null)}
          aria-label="Paired recording"
        >
          <option value="">No recording</option>
          {p.recordings.map((r) => (
            <option key={r.id} value={r.id}>
              {r.artist ? `${r.artist} – ` : ''}
              {r.name}
            </option>
          ))}
        </Select>
      </label>
      {p.recordings.length === 0 && (
        <p className={t.hint}>
          Import the song's audio as a backing track first, then pair it here.
        </p>
      )}

      {paired && (
        <>
          <div className={t.segmented} role="radiogroup" aria-label="Playback sound">
            {(['recording', 'synth'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={p.source === s}
                className={p.source === s ? t.segOn : ''}
                onClick={() => p.onSource(s)}
              >
                {s === 'recording' ? 'Recording' : 'Synth'}
              </button>
            ))}
          </div>

          <div className={t.tapRow}>
            <HardwareButton
              size="small"
              label={`Tap bar ${p.tapBar + 1}`}
              title="While the recording plays, tap at the first beat of this bar (Enter)"
              icon={<I.TempoIcon size={14} />}
              disabled={p.source !== 'recording'}
              onClick={p.onTap}
            />
            <label className={t.textField} title="Bar the next tap marks">
              <span className={styles.dim}>bar</span>
              <input
                type="number"
                min={1}
                max={p.barCount}
                value={p.tapBar + 1}
                onChange={(e) =>
                  p.onTapBar(Math.min(p.barCount, Math.max(1, Number(e.target.value))) - 1)
                }
                aria-label="Next bar to tap"
              />
            </label>
          </div>
          <p className={t.hint}>
            Play the recording and press <kbd>Enter</kbd> (or the button) on the first beat of each
            bar. One tap sets the start; more taps follow tempo changes.
          </p>

          <div className={t.tapRow}>
            <label
              className={styles.check}
              title="Mix the selected track's synth over the recording, bar by bar, to hear your part"
            >
              <input
                type="checkbox"
                checked={p.guide > 0}
                disabled={points.length === 0}
                onChange={(e) => p.onGuide(e.target.checked ? 0.6 : 0)}
              />
              Guide: {p.guideTrack}
            </label>
            {p.guide > 0 && (
              <Select
                value={p.guide}
                onChange={(e) => p.onGuide(Number(e.target.value))}
                aria-label="Guide level"
              >
                {[0.3, 0.6, 1].map((v) => (
                  <option key={v} value={v}>
                    {v === 0.3 ? 'soft' : v === 0.6 ? 'medium' : 'loud'}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {points.length === 0 && p.guide === 0 && (
            <p className={t.hint}>Tap at least one bar to enable the guide track.</p>
          )}

          {points.length > 0 && (
            <>
              <div className={t.tapRow}>
                <span className={styles.dim}>Nudge</span>
                <HardwareButton size="small" label="−50 ms" onClick={() => p.onNudge(-0.05)} />
                <HardwareButton size="small" label="+50 ms" onClick={() => p.onNudge(0.05)} />
                <HardwareButton size="small" label="Clear" variant="danger" onClick={p.onClear} />
              </div>
              <ul className={t.pointList}>
                {points.map((pt, i) => (
                  <li key={`${pt.score}:${pt.audio}`}>
                    <span>Bar {p.barOf(pt.score) + 1}</span>
                    <span className={styles.dim}>{formatTime(pt.audio)}</span>
                    <button
                      type="button"
                      onClick={() => p.onRemovePoint(i)}
                      aria-label={`Remove the sync point for bar ${p.barOf(pt.score) + 1}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
  if (p.bare) return body
  return (
    <details className={t.sideSection} open={!!p.sync}>
      <summary>
        <I.SyncIcon size={14} /> Recording sync
        {p.sync && <span className={t.sideBadge}>{points.length} pts</span>}
      </summary>
      {body}
    </details>
  )
}
