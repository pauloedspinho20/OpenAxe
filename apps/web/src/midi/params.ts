import { getParamSchema } from '../effects/paramSchema'
import { useGraphStore } from '../state/graphStore'

/**
 * Continuous MIDI control for effect knobs - the counterpart to dispatch.ts's
 * discrete scene/slot triggers.
 *
 * A bound CC's 7-bit value (0-127) sweeps the param across its schema
 * range, quantized to the schema step exactly the way Knob.commit does, so a
 * mapped CC and a dragged knob always land on the same lattice of values.
 * Writes go through graphStore.setBlockParams, never straight to the live
 * block - useBlockParamValues syncs the knobs back from the store, so the UI
 * follows an incoming CC without any extra wiring.
 *
 * Unknown targets (block removed, param renamed, select-type field) resolve
 * to null and dispatch treats them as no-ops - orphaned mappings can only
 * ever do nothing, never throw.
 */
export function midiValueToParam(
  blockId: string,
  paramKey: string,
  midiValue: number,
): number | null {
  const block = useGraphStore.getState().blocks.find((b) => b.id === blockId)
  if (!block) return null
  const field = getParamSchema(block.kind).find((f) => f.key === paramKey)
  if (!field || field.control !== 'knob') return null
  const { min, max, step } = field
  const clamped = Math.min(127, Math.max(0, midiValue)) / 127
  const raw = min + clamped * (max - min)
  return Math.min(max, Math.max(min, Math.round(raw / step) * step))
}

/** Applies one incoming CC value to a mapped param. False when the target is gone. */
export function applyMidiParamValue(blockId: string, paramKey: string, midiValue: number): boolean {
  const value = midiValueToParam(blockId, paramKey, midiValue)
  if (value === null) return false
  useGraphStore.getState().setBlockParams(blockId, { [paramKey]: value })
  return true
}
