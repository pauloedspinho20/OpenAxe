/**
 * Tempo sync for blocks. `tempoSync` is a UI-only param ('off' or a note
 * division); while it is set, the block's time/rate param is overwritten from
 * the global BPM (tempoStore). The core never sees `tempoSync` itself - only
 * the resulting `time` (ms) / `rate` (Hz), which are ordinary core params - so
 * presets, undo and every front end keep working unchanged.
 */
import type { EffectKind, EffectParams } from './Effect'
import { PARAM_RANGES } from './generatedParamRanges'
import { NOTE_DIVISIONS, divisionToHz, divisionToMs, type NoteDivision } from '../state/tempoStore'

export const TEMPO_SYNC_KEY = 'tempoSync'

interface SyncTarget {
  /** The core param the synced value is written to. */
  key: string
  /** `ms`: delay time = one division. `hz`: one LFO cycle = one division. */
  unit: 'ms' | 'hz'
}

const SYNC_TARGETS: Partial<Record<EffectKind, SyncTarget>> = {
  delay: { key: 'time', unit: 'ms' },
  tremolo: { key: 'rate', unit: 'hz' },
  chorus: { key: 'rate', unit: 'hz' },
  flanger: { key: 'rate', unit: 'hz' },
}

export const TEMPO_SYNC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'off', label: 'Off' },
  ...NOTE_DIVISIONS.map((d) => ({ value: d.value, label: d.label })),
]

export function supportsTempoSync(kind: string): kind is EffectKind {
  return kind in SYNC_TARGETS
}

export function isTempoSynced(params: EffectParams): boolean {
  return isDivision(params[TEMPO_SYNC_KEY])
}

function isDivision(v: unknown): v is NoteDivision {
  return typeof v === 'string' && NOTE_DIVISIONS.some((d) => d.value === v)
}

/**
 * The param write a synced block needs at `bpm`, clamped to the core's range
 * (a 1/1 at 60 BPM is 4 s, longer than most delays allow), or null when the
 * block is not synced or already holds that value.
 */
export function tempoSyncedParams(
  kind: string,
  params: EffectParams,
  bpm: number,
): EffectParams | null {
  if (!supportsTempoSync(kind)) return null
  const division = params[TEMPO_SYNC_KEY]
  if (!isDivision(division)) return null
  const target = SYNC_TARGETS[kind]!
  const range = (
    PARAM_RANGES[kind as keyof typeof PARAM_RANGES] as Record<string, { min: number; max: number }>
  )[target.key]
  if (!range) return null
  const raw = target.unit === 'ms' ? divisionToMs(bpm, division) : divisionToHz(bpm, division)
  const value = Math.round(Math.min(range.max, Math.max(range.min, raw)) * 1000) / 1000
  return params[target.key] === value ? null : { [target.key]: value }
}
