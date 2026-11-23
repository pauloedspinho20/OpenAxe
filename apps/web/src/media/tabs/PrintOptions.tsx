/**
 * Print options (issue #459): which tracks, the page size and orientation,
 * the staves, scale, bars per row and margins - then alphaTab's print view
 * (the browser's print dialog also saves a PDF).
 */
import { Dialog, HardwareButton, Select } from '@openaxe/ui'
import { useState } from 'react'

import styles from '../MediaCenter.module.css'
import * as I from './tabIcons'
import t from './TabWorkspace.module.css'

export type PrintProfile = 'tab' | 'both' | 'score'

export interface PrintSettings {
  tracks: number[]
  /** CSS width of the printed page, e.g. "210mm". */
  width: string
  profile: PrintProfile
  scale: number
  /** -1 = automatic. */
  barsPerRow: number
  /** Padding around the music, px. */
  margin: number
}

const PAGES = [
  { id: 'a4p', label: 'A4 portrait', width: '210mm' },
  { id: 'a4l', label: 'A4 landscape', width: '297mm' },
  { id: 'lp', label: 'Letter portrait', width: '8.5in' },
  { id: 'll', label: 'Letter landscape', width: '11in' },
] as const

const MARGINS = [
  { label: 'narrow', px: 15 },
  { label: 'normal', px: 35 },
  { label: 'wide', px: 70 },
] as const

interface PrintOptionsProps {
  tracks: { name: string }[]
  shown: number[]
  profile: PrintProfile
  onPrint: (s: PrintSettings) => void
  onClose: () => void
}

export function PrintOptions({ tracks, shown, profile, onPrint, onClose }: PrintOptionsProps) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(shown))
  const [page, setPage] = useState<(typeof PAGES)[number]['id']>('a4p')
  const [prof, setProf] = useState<PrintProfile>(profile)
  const [scale, setScale] = useState(0.9)
  const [bars, setBars] = useState(-1)
  const [margin, setMargin] = useState(35)
  const toggle = (i: number) =>
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Print / PDF"
      ariaLabel="Print options"
      width="min(720px, 94vw)"
    >
      <span className={styles.dim}>
        Choose what goes on the page; “Save as PDF” is in the print dialog.
      </span>
      <div className={t.printGrid}>
        <fieldset>
          <legend>Tracks</legend>
          {tracks.map((tr, i) => (
            <label key={i} className={styles.check}>
              <input type="checkbox" checked={chosen.has(i)} onChange={() => toggle(i)} />
              {tr.name}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Page</legend>
          <Select
            value={page}
            onChange={(e) => setPage(e.target.value as typeof page)}
            aria-label="Page size"
          >
            {PAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <label>
            <span className={styles.dim}>margins</span>
            <Select
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              aria-label="Margins"
            >
              {MARGINS.map((m) => (
                <option key={m.px} value={m.px}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Music</legend>
          <Select
            value={prof}
            onChange={(e) => setProf(e.target.value as PrintProfile)}
            aria-label="Staves"
          >
            <option value="tab">Tab only</option>
            <option value="both">Notation + tab</option>
            <option value="score">Notation only</option>
          </Select>
          <label>
            <span className={styles.dim}>size {Math.round(scale * 100)}%</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              aria-label="Print scale"
            />
          </label>
          <label>
            <span className={styles.dim}>bars per row</span>
            <Select
              value={bars}
              onChange={(e) => setBars(Number(e.target.value))}
              aria-label="Bars per row"
            >
              <option value={-1}>auto</option>
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        </fieldset>
      </div>
      <div className={t.tapRow}>
        <HardwareButton
          size="small"
          label="Print…"
          icon={<I.PageLayoutIcon size={14} />}
          disabled={chosen.size === 0}
          onClick={() =>
            onPrint({
              tracks: [...chosen].sort((a, b) => a - b),
              width: PAGES.find((p) => p.id === page)!.width,
              profile: prof,
              scale,
              barsPerRow: bars,
              margin,
            })
          }
        />
        {chosen.size === 0 && <span className={styles.dim}>Pick at least one track.</span>}
      </div>
    </Dialog>
  )
}
