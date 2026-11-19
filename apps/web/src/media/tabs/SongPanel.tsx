/**
 * Song info and track management (issue #206): title/artist/album, add or
 * remove tracks from instrument presets, rename, instrument (GM program),
 * tuning presets and capo.
 */
import type { model, Settings } from '@coderline/alphatab'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import type { EditCursor } from './scoreEdit'
import * as ops from './scoreOps'
import tabStyles from './TabWorkspace.module.css'

type Apply = (fn: (score: model.Score, s: Settings) => EditCursor | void) => void

interface SongPanelProps {
  score: model.Score
  trackIndex: number
  apply: Apply
  onSelectTrack: (index: number) => void
}

export function SongPanel({ score, trackIndex, apply, onSelectTrack }: SongPanelProps) {
  const [preset, setPreset] = useState(ops.INSTRUMENTS[0]!.id)

  const info = (key: keyof ops.SongInfo, label: string) => (
    <label className={tabStyles.field}>
      <span>{label}</span>
      <input
        defaultValue={score[key]}
        key={`${key}:${score[key]}`}
        onBlur={(e) => {
          if (e.target.value !== score[key])
            apply((sc, s) => ops.setSongInfo(sc, { [key]: e.target.value }, s))
        }}
      />
    </label>
  )

  return (
    <div className={tabStyles.songPanel}>
      <div className={tabStyles.songInfo}>
        {info('title', 'Title')}
        {info('subTitle', 'Subtitle')}
        {info('artist', 'Artist')}
        {info('album', 'Album')}
        {info('music', 'Music by')}
        {info('tab', 'Tab by')}
      </div>
      <table className={tabStyles.trackTable}>
        <thead>
          <tr>
            <th>Track</th>
            <th>Instrument</th>
            <th>Tuning</th>
            <th>Capo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {score.tracks.map((t, i) => {
            const staff = t.staves[0]!
            const strings = staff.stringTuning.tunings.length
            const presets = strings > 0 ? ops.tuningPresets(strings) : []
            const current = staff.stringTuning.tunings.join(',')
            return (
              <tr key={`${i}:${t.name}`} className={i === trackIndex ? tabStyles.trackRowOn : ''}>
                <td>
                  <input
                    className={tabStyles.cellInput}
                    defaultValue={t.name}
                    onFocus={() => onSelectTrack(i)}
                    onBlur={(e) => {
                      if (e.target.value !== t.name)
                        apply((sc, s) => ops.renameTrack(sc, i, e.target.value, s))
                    }}
                    aria-label={`Track ${i + 1} name`}
                  />
                </td>
                <td>
                  {staff.isPercussion ? (
                    <span className={styles.dim}>Drums</span>
                  ) : (
                    <select
                      className={styles.select}
                      value={t.playbackInfo.program}
                      onChange={(e) =>
                        apply((sc, s) => ops.setProgram(sc, i, Number(e.target.value), s))
                      }
                      aria-label={`Track ${i + 1} instrument`}
                    >
                      {!ops.PROGRAMS.some((p) => p.program === t.playbackInfo.program) && (
                        <option value={t.playbackInfo.program}>GM #{t.playbackInfo.program}</option>
                      )}
                      {ops.PROGRAMS.map((p) => (
                        <option key={p.program} value={p.program}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {strings > 0 ? (
                    <select
                      className={styles.select}
                      value={current}
                      onChange={(e) =>
                        apply((sc, s) =>
                          ops.setTuning(sc, i, e.target.value.split(',').map(Number), s),
                        )
                      }
                      aria-label={`Track ${i + 1} tuning`}
                    >
                      {!presets.some((p) => p.tunings.join(',') === current) && (
                        <option value={current}>
                          {ops.tuningLabel(staff.stringTuning.tunings)}
                        </option>
                      )}
                      {presets.map((p) => (
                        <option key={p.name} value={p.tunings.join(',')}>
                          {p.name.replace(/^(Guitar|Bass) /, '')} — {ops.tuningLabel(p.tunings)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={styles.dim}>—</span>
                  )}
                </td>
                <td>
                  {strings > 0 && (
                    <input
                      className={tabStyles.num}
                      type="number"
                      min={0}
                      max={24}
                      value={staff.capo}
                      onChange={(e) =>
                        apply((sc, s) => ops.setCapo(sc, i, Number(e.target.value), s))
                      }
                      aria-label={`Track ${i + 1} capo`}
                    />
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className={tabStyles.pbtn}
                    disabled={score.tracks.length <= 1}
                    onClick={() => {
                      if (!confirm(`Remove the track "${t.name}"?`)) return
                      apply((sc, s) => ops.removeTrack(sc, i, s))
                      onSelectTrack(Math.max(0, Math.min(trackIndex, score.tracks.length - 2)))
                    }}
                    title="Remove track"
                    aria-label={`Remove track ${t.name}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className={tabStyles.paletteGroup}>
        <select
          className={styles.select}
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          aria-label="New track instrument"
        >
          {ops.INSTRUMENTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.chip}
          onClick={() => {
            const p = ops.INSTRUMENTS.find((x) => x.id === preset)!
            let index = 0
            apply((sc, s) => {
              index = ops.addTrack(sc, p, p.label, s)
            })
            onSelectTrack(index)
          }}
        >
          + Add track
        </button>
      </div>
    </div>
  )
}
