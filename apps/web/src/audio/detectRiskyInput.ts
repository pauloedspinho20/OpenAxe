/**
 * Internal-microphone feedback guard (issue #422).
 *
 * A laptop's built-in mic + speakers form a loop through the rig: the
 * processed output feeds straight back into the input, which howls, noises,
 * and at volume can damage hearing and speakers. This module is the single
 * source of truth for spotting that situation. It operates on plain
 * {@link IODevice} rows, so the web (MediaDevices) and desktop (native
 * RtAudio/JUCE names via `enumerateNative`) paths share it verbatim.
 *
 * Design notes:
 * - Heuristics, not a vendor list: match word patterns (`built-in`,
 *   `internal`, `macbook`, …) that recur across CoreAudio/WASAPI/PulseAudio.
 * - Tri-state result: `safe` needs no guard; `risky` is almost certainly an
 *   internal mic; `unknown` means we cannot tell yet (empty labels before mic
 *   permission is granted, a bare "Microphone" label, or `Default` while an
 *   internal mic is in the list). `unknown` gets gentler copy but the same
 *   acknowledgement flow — it may silently *be* the internal mic.
 * - `groupId` is deliberately weak evidence on its own: duplex USB interfaces
 *   (e.g. a Scarlett) legitimately group their input with their output, so a
 *   shared group only counts when the input label is a generic mic name AND
 *   the grouped output looks like speakers. This keeps real interfaces nag-free.
 * - Zero enumerated inputs + `Default` is `safe`: there is no evidence of
 *   risk (e.g. `enumerateDevices` failed in an insecure context), and blocking
 *   power-on there would strand the user. The engine still surfaces real
 *   `getUserMedia` failures as before.
 */
import type { IODevice } from '../state/ioStore'

export type InputRisk = 'safe' | 'risky' | 'unknown'

/** Labels that are almost certainly a built-in/internal microphone. */
const INTERNAL_MIC_PATTERN =
  /built[\s_-]?in|internal|macbook|imac|facetime|isight|\bimic\b|microphone array|array mic|front mic/i

/** Labels too vague to classify — could be anything, including internal. */
const GENERIC_UNKNOWN_PATTERN =
  /^(default|microphone|mic|audio[_\s-]?input|input|external microphone)(\s*[\d-]+)?$/i

/** Any mic-ish wording, used only together with a same-group speakers output. */
const GENERIC_MIC_PATTERN = /mic|input|array/i

/** Output labels that suggest the paired device plays through speakers. */
const SPEAKERS_PATTERN = /speaker|output|headphone|headset|built[\s_-]?in/i

function sharesGroupWithSpeakers(device: IODevice, outputs: IODevice[]): boolean {
  if (!device.groupId) return false
  return outputs.some((o) => {
    if (!o.groupId || o.groupId !== device.groupId) return false
    // Pre-permission output labels are empty too — assume the worst, since a
    // same-hardware output paired with a generic mic is exactly the laptop
    // combo this guard exists for.
    if (o.label.trim() === '') return true
    return SPEAKERS_PATTERN.test(o.label)
  })
}

function labelRisk(label: string, device: IODevice, outputs: IODevice[]): InputRisk {
  const trimmed = label.trim()
  if (trimmed === '') return 'unknown'
  if (INTERNAL_MIC_PATTERN.test(trimmed)) return 'risky'
  if (GENERIC_UNKNOWN_PATTERN.test(trimmed)) return 'unknown'
  if (GENERIC_MIC_PATTERN.test(trimmed) && sharesGroupWithSpeakers(device, outputs)) {
    return 'risky'
  }
  return 'safe'
}

/**
 * Classify the currently selected input. `inputDeviceId === ''` is the
 * `Default input` option (the OS picks the device).
 */
export function classifyInputRisk(
  inputDeviceId: string,
  inputs: IODevice[],
  outputs: IODevice[],
): InputRisk {
  const selected = inputs.find((d) => d.deviceId === inputDeviceId)
  if (selected) return labelRisk(selected.label, selected, outputs)
  // A non-empty id that matches nothing is stale (device unplugged, store not
  // yet reset by useAudioIO) — gentle variant, not a block on stale data.
  if (inputDeviceId !== '') return 'unknown'
  if (inputs.length === 0) return 'safe'
  // Default with visible internal mics in the list may well resolve to one.
  if (inputs.some((d) => d.label.trim() !== '' && INTERNAL_MIC_PATTERN.test(d.label))) {
    return 'unknown'
  }
  // Partially-labelled lists (permission just granted, re-enumerating) can't
  // rule an internal mic out either.
  if (inputs.some((d) => d.label.trim() === '')) return 'unknown'
  return 'safe'
}

/** The display label of the selected input, or `''` for `Default input`. */
export function resolveSelectedInputLabel(inputDeviceId: string, inputs: IODevice[]): string {
  return inputs.find((d) => d.deviceId === inputDeviceId)?.label ?? ''
}

/**
 * Whether the acknowledgement snapshot matches the current selection.
 * Acknowledgements are per-device (id + label): switching input re-arms the
 * guard, and labels resolving after permission is granted invalidate a
 * pre-permission ack — both re-arm rather than assume consent.
 */
export function isMicRiskAcknowledged(
  inputDeviceId: string,
  selectedLabel: string,
  ackDeviceId: string | null,
  ackLabel: string | null,
): boolean {
  if (ackDeviceId === null) return false
  return ackDeviceId === inputDeviceId && (ackLabel ?? '') === (selectedLabel ?? '')
}

/** Engine-level refusal text when a risky/unacked mic must not go live. */
export function micRiskBlockedMessage(risk: InputRisk): string {
  if (risk === 'risky') {
    return 'Built-in microphone blocked to prevent feedback — tick the acknowledgement to use it anyway, or play a DI take from the Input dialog.'
  }
  return 'Input blocked until confirmed — tick the acknowledgement to use this input, or play a DI take from the Input dialog.'
}
