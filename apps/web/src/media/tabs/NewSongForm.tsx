/**
 * New-song wizard (issue #206 / #174): title, artist, tempo, time signature,
 * length and the first instrument, turned into AlphaTex and imported through
 * the normal library path.
 */
import { Select } from '@openaxe/ui'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import { useMediaStore } from '../mediaStore'
import { INSTRUMENTS, newSongTex } from './scoreOps'
import tabStyles from './TabWorkspace.module.css'

export function NewSongForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('Untitled')
  const [artist, setArtist] = useState('')
  const [tempo, setTempo] = useState(120)
  const [numerator, setNumerator] = useState(4)
  const [denominator, setDenominator] = useState(4)
  const [bars, setBars] = useState(16)
  const [instrument, setInstrument] = useState(INSTRUMENTS[0]!.id)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const tex = newSongTex({
        title,
        artist,
        tempo,
        numerator,
        denominator,
        bars,
        instrument: INSTRUMENTS.find((i) => i.id === instrument)!,
      })
      const name = `${artist ? `${artist} - ` : ''}${title || 'Untitled'}.atex`
      const added = await useMediaStore
        .getState()
        .importFiles([new File([tex], name, { type: 'text/plain' })])
      if (added[0]) await useMediaStore.getState().open(added[0].id)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className={tabStyles.songPanel}
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
      aria-label="New song"
    >
      <label className={tabStyles.field}>
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className={tabStyles.field}>
        <span>Artist</span>
        <input value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>
      <div className={tabStyles.songInfo}>
        <label className={tabStyles.field}>
          <span>Tempo (BPM)</span>
          <input
            type="number"
            min={20}
            max={400}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
          />
        </label>
        <label className={tabStyles.field}>
          <span>Time signature</span>
          <span className={tabStyles.paletteGroup}>
            <input
              className={tabStyles.num}
              type="number"
              min={1}
              max={32}
              value={numerator}
              onChange={(e) => setNumerator(Number(e.target.value))}
              aria-label="Beats per bar"
            />
            /
            <Select
              value={denominator}
              onChange={(e) => setDenominator(Number(e.target.value))}
              aria-label="Beat unit"
            >
              {[2, 4, 8, 16].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </span>
        </label>
        <label className={tabStyles.field}>
          <span>Bars</span>
          <input
            type="number"
            min={1}
            max={512}
            value={bars}
            onChange={(e) => setBars(Number(e.target.value))}
          />
        </label>
      </div>
      <label className={tabStyles.field}>
        <span>Instrument</span>
        <Select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </label>
      <div className={tabStyles.paletteGroup}>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className={styles.chip} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
