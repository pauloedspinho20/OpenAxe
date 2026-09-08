/**
 * A plain module holding the MIDIAccess singleton and its listeners - not a
 * hook. A MIDI connection is session-lifetime hardware state; a hook would
 * mean StrictMode double-invoking requestMIDIAccess() and re-subscribing
 * listeners on every unrelated re-render. See useMidiEngine.ts for the one
 * React seam (config load + auto-connect on mount).
 */
import { actionKey } from './actions'
import { executeMidiAction, executeMidiParamAction } from './dispatch'
import { isTriggerEdge, messageMatches, parseMidiMessage } from './message'
import { useMidiManager } from '../state/midiManager'
import { useMidiStore } from '../state/midiStore'
import type { MidiAction } from './actions'

const LEARN_TIMEOUT_MS = 15000

let access: MIDIAccess | null = null
const boundInputs = new Set<MIDIInput>()
const learnTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

export function isMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
}

/** Call from a user gesture (a button click) - browsers require one for the permission prompt. */
export async function requestMidiAccess(): Promise<void> {
  if (!isMidiSupported()) {
    useMidiStore
      .getState()
      .setPermission('denied', "This browser doesn't support the Web MIDI API.")
    return
  }
  try {
    // Never request sysex - it triggers a scarier permission prompt and nothing here needs it.
    access = await navigator.requestMIDIAccess({ sysex: false })
    access.onstatechange = refreshInputs
    refreshInputs()
    useMidiStore.getState().setPermission('granted')
  } catch (err) {
    access = null
    useMidiStore
      .getState()
      .setPermission('denied', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Silently connects only if the user already granted MIDI access in a past
 * session - never prompts unprompted on page load. Wrapped in try/catch
 * since Firefox/Safari/jsdom don't support querying this permission name.
 */
export async function autoConnectIfPermitted(): Promise<void> {
  if (!isMidiSupported()) return
  try {
    const status = await navigator.permissions?.query({ name: 'midi' as PermissionName })
    if (status?.state === 'granted') await requestMidiAccess()
  } catch {
    // Permission name unsupported here - fine, just don't auto-connect.
  }
}

export function disconnectMidi(): void {
  for (const input of boundInputs) input.onmidimessage = null
  boundInputs.clear()
  if (access) access.onstatechange = null
  access = null
}

function refreshInputs(): void {
  if (!access) return
  const inputs = Array.from(access.inputs.values()).map((input) => ({
    id: input.id,
    name: input.name ?? input.manufacturer ?? input.id,
  }))
  useMidiStore.getState().setInputs(inputs)
  bindInputs()
}

/** Binds the selected input, or every input when none is selected (the default - works with zero configuration). */
function bindInputs(): void {
  if (!access) return
  for (const input of boundInputs) input.onmidimessage = null
  boundInputs.clear()

  const selectedId = useMidiStore.getState().selectedInputId
  for (const input of access.inputs.values()) {
    if (selectedId !== null && input.id !== selectedId) continue
    input.onmidimessage = handleMessage
    boundInputs.add(input)
  }
}

useMidiStore.subscribe((state, prev) => {
  if (state.selectedInputId !== prev.selectedInputId) bindInputs()
})

function handleMessage(event: MIDIMessageEvent): void {
  const message = parseMidiMessage(event.data)
  if (!message) return
  useMidiStore.getState().setLastMessage(message)

  const learning = useMidiStore.getState().learning
  if (learning) {
    // Param targets learn CC only - a note or PC has no value to sweep a
    // knob with, so binding one would create a dead mapping. Param learns
    // also skip the trigger-edge gate: a CC resting below 64 is still a
    // perfectly good knob binding.
    if (learning.action.kind === 'param') {
      if (message.type !== 'cc') return
    } else if (!isTriggerEdge(message)) {
      return
    }
    // Never also dispatch the action a message just got bound to.
    useMidiStore.getState().completeLearn({
      type: message.type,
      channel: message.channel,
      number: message.number,
    })
    return
  }

  // While the mapping modal is open, test presses shouldn't yank the live rig.
  if (useMidiManager.getState().open) return

  const mappings = useMidiStore.getState().mappings
  const hit = mappings.find((m) => messageMatches(message, m.match))
  if (!hit) return
  if (hit.action.kind === 'param') {
    // Continuous: every CC value moves the knob, not just the trigger edge.
    if (message.type !== 'cc') return
    executeMidiParamAction(hit.action.blockId, hit.action.paramKey, message.value)
    return
  }
  if (!isTriggerEdge(message)) return
  executeMidiAction(hit.action)
}

/** Arms Learn for `action`, auto-cancelling (keyed, so a stale timer can't cancel a newer learn) after 15s. */
export function armLearn(action: MidiAction): void {
  useMidiStore.getState().startLearn(action)
  const key = actionKey(action)
  const existing = learnTimeouts.get(key)
  if (existing) clearTimeout(existing)
  learnTimeouts.set(
    key,
    setTimeout(() => {
      learnTimeouts.delete(key)
      useMidiStore.getState().cancelLearn(key)
    }, LEARN_TIMEOUT_MS),
  )
}
