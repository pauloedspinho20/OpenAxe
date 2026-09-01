/**
 * DI audition samples bundled under `apps/web/public/di-samples/`.
 * Each WAV is mono 48 kHz — the graph's native rate — so no resampling is needed.
 * Files are fetched + decoded via AudioContext.decodeAudioData and cached in memory.
 *
 * The current commits ship placeholder tones (issue #273 tracks replacing them with
 * original recordings). The API is stable so swapping the WAV bytes requires no
 * code change — only dropping the final recordings into `public/di-samples/`.
 */

export interface DISample {
  /** Stable id, also the filename without extension. */
  id: string
  label: string
  /** Guitar vs bass — for grouping in the UI. */
  instrument: 'guitar' | 'bass'
  /** URL relative to the web root. */
  url: string
  /** One-line hint shown as the option's title / screen-reader description. */
  description: string
}

export const DI_SAMPLES: readonly DISample[] = [
  {
    id: 'guitar-clean',
    label: 'Guitar — Clean',
    instrument: 'guitar',
    url: '/di-samples/fender-stratocaster-neck-solo.wav',
    description: 'Clean arpeggio — Fender Stratocaster Neck Solo',
  },
  {
    id: 'guitar-rock',
    label: 'Guitar — Rock',
    instrument: 'guitar',
    url: '/di-samples/guitar-rock.wav',
    description: 'Rock rhythm — open chords',
  },
  {
    id: 'guitar-metal',
    label: 'Guitar — Metal',
    instrument: 'guitar',
    url: '/di-samples/guitar-metal.wav',
    description: 'High-gain chug — palm mute',
  },
  {
    id: 'guitar-funk',
    label: 'Guitar — Funk',
    instrument: 'guitar',
    url: '/di-samples/guitar-funk.wav',
    description: 'Funk — percussive comping',
  },
  {
    id: 'bass-finger',
    label: 'Bass — Finger',
    instrument: 'bass',
    url: '/di-samples/bass-finger.wav',
    description: 'Fingerstyle — round low end',
  },
  {
    id: 'bass-pick',
    label: 'Bass — Pick',
    instrument: 'bass',
    url: '/di-samples/bass-pick.wav',
    description: 'Pick — tight attack',
  },
  {
    id: 'bass-slap',
    label: 'Bass — Slap',
    instrument: 'bass',
    url: '/di-samples/bass-slap.wav',
    description: 'Slap — transient snap',
  },
] as const

export type DISampleId = (typeof DI_SAMPLES)[number]['id']

export function getDISample(id: string): DISample | undefined {
  return DI_SAMPLES.find((s) => s.id === id)
}
