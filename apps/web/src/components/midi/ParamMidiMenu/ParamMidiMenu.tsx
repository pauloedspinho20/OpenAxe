import { ContextMenu, type ContextMenuAnchor, type ContextMenuItem } from '@openaxe/ui'
import { actionKey } from '../../../midi/actions'
import { armLearn } from '../../../midi/midiAccess'
import { formatMidiMatch } from '../../../midi/message'
import { useMidiStore } from '../../../state/midiStore'

export interface ParamMidiTarget {
  blockId: string
  paramKey: string
  paramLabel: string
}

export interface ParamMidiMenuProps {
  anchor: ContextMenuAnchor | null
  target: ParamMidiTarget | null
  onClose: () => void
}

/**
 * The right-click menu for one effect knob: MIDI Learn / bound-binding
 * display / Clear, reusing the same midiStore learn flow as the preset
 * slot/scene rows in MidiManager (armLearn, actionKey identity,
 * clearMappingForAction). Rendered once per params surface and retargeted
 * per knob - not one menu per knob.
 */
export function ParamMidiMenu({ anchor, target, onClose }: ParamMidiMenuProps) {
  const key = target
    ? actionKey({ kind: 'param', blockId: target.blockId, paramKey: target.paramKey })
    : null
  const mapping = useMidiStore((s) =>
    key ? s.mappings.find((m) => actionKey(m.action) === key) : undefined,
  )
  const learningKey = useMidiStore((s) => s.learning?.actionKey)
  const supported = useMidiStore((s) => s.supported)
  const permission = useMidiStore((s) => s.permission)

  const open = anchor !== null && target !== null
  const learningThis = key !== null && learningKey === key
  const connected = supported && permission === 'granted'

  const items: ContextMenuItem[] = []
  if (mapping) {
    items.push({
      id: 'binding',
      label: `MIDI · ${formatMidiMatch(mapping.match)}`,
      disabled: true,
      title: `${target?.paramLabel} follows this control`,
      onSelect: () => {},
    })
  }
  if (target) {
    const learnDisabled = !connected
    items.push({
      id: 'learn',
      label: learningThis
        ? 'Listening… (click to cancel)'
        : mapping
          ? 'Re-learn MIDI…'
          : 'MIDI Learn…',
      disabled: learnDisabled,
      title: learnDisabled
        ? !supported
          ? "This browser doesn't support the Web MIDI API - try Chrome or Edge."
          : 'Enable MIDI in the MIDI manager before learning.'
        : 'Move a MIDI control to bind it to this knob.',
      onSelect: () => {
        if (learningThis && key) useMidiStore.getState().cancelLearn(key)
        else armLearn({ kind: 'param', blockId: target.blockId, paramKey: target.paramKey })
      },
    })
  }
  if (mapping && key) {
    items.push({
      id: 'clear',
      label: 'Clear MIDI mapping',
      danger: true,
      onSelect: () => useMidiStore.getState().clearMappingForAction(key),
    })
  }

  return (
    <ContextMenu
      open={open}
      anchor={anchor}
      items={items}
      onClose={onClose}
      label={target ? `MIDI mapping for ${target.paramLabel}` : 'MIDI mapping'}
    />
  )
}
