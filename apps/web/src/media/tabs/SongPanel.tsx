/**
 * Song info and track management (issue #206), shown in the workspace's
 * right-hand drawer: title/artist/album, and one card per track with its
 * name, instrument (GM program), tuning preset and capo. Tracks are added
 * from instrument presets.
 */
import type { model, Settings } from '@coderline/alphatab'
import { HardwareButton } from '@openaxe/ui'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import type { EditCursor } from './scoreEdit'
import * as ops from './scoreOps'
import * as I from './tabIcons'
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
      <section className={tabStyles.boxSection}>
        <h4>Song</h4>
        <div className={tabStyles.songInfo}>
          {info('title', 'Title')}
          {info('subTitle', 'Subtitle')}
          {info('artist', 'Artist')}
          {info('album', 'Album')}
          {info('music', 'Music by')}
          {info('tab', 'Tab by')}
        </div>
      </section>

      <section className={tabStyles.boxSection}>
        <h4>Tracks</h4>
        {score.tracks.map((t, i) => {
          const staff = t.staves[0]!
          const strings = staff.stringTuning.tunings.length
          const presets = strings > 0 ? ops.tuningPresets(strings) : []
          const current = staff.stringTuning.tunings.join(',')
          return (
            <div
              key={`${i}:${t.name}`}
              className={`${tabStyles.trackCard} ${i === trackIndex ? tabStyles.trackCardOn : ''}`}
            >
              <div className={tabStyles.trackCardHead}>
                <HardwareButton
                  size="small"
                  label={`Show track ${t.name}`}
                  icon={staff.isPercussion ? <I.DrumIcon size={14} /> : <I.TabIcon size={14} />}
                  iconOnly
                  active={i === trackIndex}
                  onClick={() => onSelectTrack(i)}
                />
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
                <HardwareButton
                  size="small"
                  label={`Remove track ${t.name}`}
                  icon={<I.TrashIcon size={14} />}
                  iconOnly
                  variant="danger"
                  disabled={score.tracks.length <= 1}
                  onClick={() => {
                    if (!confirm(`Remove the track "${t.name}"?`)) return
                    apply((sc, s) => ops.removeTrack(sc, i, s))
                    onSelectTrack(Math.max(0, Math.min(trackIndex, score.tracks.length - 2)))
                  }}
                />
              </div>
              {staff.isPercussion ? (
                <span className={styles.dim}>Drum kit (General MIDI channel 10)</span>
              ) : (
                <div className={tabStyles.trackCardBody}>
                  <label className={tabStyles.textField} title="Instrument sound">
                    <I.NoteGlyphIcon size={14} />
                    <select
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
                  </label>
                  {strings > 0 && (
                    <>
                      <label className={tabStyles.textField} title="Tuning">
                        <I.TuningIcon size={14} />
                        <select
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
                      </label>
                      <label className={tabStyles.textField} title="Capo fret">
                        <I.CapoIcon size={14} />
                        <input
                          type="number"
                          min={0}
                          max={24}
                          value={staff.capo}
                          onChange={(e) =>
                            apply((sc, s) => ops.setCapo(sc, i, Number(e.target.value), s))
                          }
                          aria-label={`Track ${i + 1} capo`}
                        />
                        <span className={styles.dim}>capo</span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div className={tabStyles.textField}>
          <select
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
          <HardwareButton
            size="small"
            label="Add track"
            icon={<I.PlusIcon size={14} />}
            onClick={() => {
              const p = ops.INSTRUMENTS.find((x) => x.id === preset)!
              let index = 0
              apply((sc, s) => {
                index = ops.addTrack(sc, p, p.label, s)
              })
              onSelectTrack(index)
            }}
          />
        </div>
      </section>
    </div>
  )
}
