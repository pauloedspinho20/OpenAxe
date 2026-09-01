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
    id: 'fender-stratocaster-neck-solo',
    label: 'Fender Stratocaster - Neck Pickup Solo',
    instrument: 'guitar',
    url: '/di-samples/fender-stratocaster-neck-solo.wav',
    description: 'Fender Stratocaster - Neck Pickup Solo',
  },
  {
    id: 'fender-stratocaster-bridge-pickup-rock',
    label: 'Fender Stratocaster - Bridge Pickup Rhythm',
    instrument: 'guitar',
    url: '/di-samples/fender-stratocaster-bridge-pickup-rock.wav',
    description: 'Fender Stratocaster - Bridge Pickup Rhythm',
  },
  {
    id: 'fender-stratocaster-neck-middle-pickup-clean',
    label: 'Fender Stratocaster - Neck Middle Pickup Clean',
    instrument: 'guitar',
    url: '/di-samples/fender-stratocaster-neck-middle-pickup-clean.wav',
    description: 'Fender Stratocaster - Neck Middle Pickup Clean',
  },
  {
    id: 'fender-stratocaster-neck-pickup-fingerstyle',
    label: 'Fender Stratocaster - Neck Pickup Fingerstyle',
    instrument: 'guitar',
    url: '/di-samples/fender-stratocaster-neck-pickup-fingerstyle.wav',
    description: 'Fender Stratocaster - Neck Pickup Fingerstyle',
  },
] as const

export type DISampleId = (typeof DI_SAMPLES)[number]['id']

export function getDISample(id: string): DISample | undefined {
  return DI_SAMPLES.find((s) => s.id === id)
}
