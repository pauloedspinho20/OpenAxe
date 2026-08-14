import { useEffect, useRef, useState } from 'react'
import { detectPitch } from '../../tuner/pitchDetect'
import { frequencyToNote, type DetectedNote } from '../../tuner/noteUtils'
import styles from './Tuner.module.css'

export interface TunerProps {
  /** Taps the raw input signal (post-trim, pre-graph) - see useAudioEngine's tunerAnalyser. */
  analyser: AnalyserNode | null
  /** 'compact' is the shelf/mini readout; 'full' is the large tuning dialog. */
  size?: 'compact' | 'full'
}

/** Detection doesn't need to run every animation frame - a tuner only needs a few readings a second. */
const DETECT_INTERVAL_MS = 100
/** Within this many cents of dead-on counts as "in tune" (a semitone is 100 cents). */
const IN_TUNE_CENTS = 5

/**
 * Real-time pitch-detection tuner (issue #7) tapping the raw input signal,
 * so it reads whatever's plugged in regardless of what the grid does to it
 * downstream. Autocorrelation-based (see pitchDetect.ts) rather than the
 * issue's suggested Pitchfinder.js-in-an-AudioWorklet - covers note name,
 * cents offset, a needle meter, and A4 reference-pitch calibration; a
 * per-string/alternate-tuning highlight is a reasonable follow-up (see
 * REFERENCE_TUNINGS in noteUtils.ts).
 */
export function Tuner({ analyser, size = 'compact' }: TunerProps) {
  const [reading, setReading] = useState<{ frequency: number; note: DetectedNote } | null>(null)
  const [referenceA4, setReferenceA4] = useState(440)
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    if (!analyser) {
      setReading(null)
      return
    }
    bufferRef.current ??= new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>

    const tick = () => {
      const buffer = bufferRef.current!
      analyser.getFloatTimeDomainData(buffer)
      const pitch = detectPitch(buffer, analyser.context.sampleRate)
      setReading(
        pitch
          ? { frequency: pitch.frequency, note: frequencyToNote(pitch.frequency, referenceA4) }
          : null,
      )
    }
    const interval = window.setInterval(tick, DETECT_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [analyser, referenceA4])

  const cents = reading?.note.cents ?? 0
  const inTune = reading !== null && Math.abs(cents) <= IN_TUNE_CENTS
  const needlePercent = Math.max(-50, Math.min(50, cents))

  return (
    <div className={`${styles.tuner} ${size === 'full' ? styles.tunerFull : ''}`}>
      <div className={styles.readout}>
        <span
          className={`${styles.note} ${reading ? (inTune ? styles.noteGood : styles.noteOff) : ''}`}
        >
          {reading ? `${reading.note.name}${reading.note.octave}` : '—'}
        </span>
        <span className={styles.freq}>{reading ? `${reading.frequency.toFixed(1)} Hz` : ' '}</span>
      </div>

      <div
        className={`${styles.meter} ${size === 'full' ? styles.meterFull : ''}`}
        role="meter"
        aria-label="Tuning offset in cents"
        aria-valuemin={-50}
        aria-valuemax={50}
        aria-valuenow={reading ? cents : 0}
      >
        <div className={styles.meterCenter} />
        {reading && (
          <div
            className={`${styles.needle} ${inTune ? styles.needleGood : styles.needleOff}`}
            style={{ left: `${50 + needlePercent}%` }}
          />
        )}
      </div>

      {size === 'full' && (
        <label className={styles.calRow} title="Reference pitch for A4 (concert pitch is 440Hz)">
          <span className="label">A4</span>
          <input
            type="number"
            min={415}
            max={466}
            value={referenceA4}
            onChange={(e) => setReferenceA4(Number(e.target.value) || 440)}
            className={styles.calInput}
            aria-label="A4 reference pitch in Hz"
          />
          <span className={`label ${styles.calUnit}`}>Hz</span>
        </label>
      )}
    </div>
  )
}
