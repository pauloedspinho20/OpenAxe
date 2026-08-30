import { useEffect } from 'react'
import { useIOStore, type InputChannelMode } from '../../../state/ioStore'
import { getShellKind } from '../../../native/openaxe'
import { Dialog, SelectField, ErrorText } from '@openaxe/ui'

export interface InputDeviceDialogProps {
  open: boolean
  onClose: () => void
}

export function InputDeviceDialog({ open, onClose }: InputDeviceDialogProps) {
  const io = useIOStore()
  // A plugin has no device to pick - the DAW decides what feeds it - but it
  // does have a stereo bus, and which side of it carries the guitar is the
  // player's choice.
  const isPluginShell = getShellKind() === 'plugin'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <Dialog open={open} onClose={onClose} title="Input" width="min(360px, 90vw)">
      {!isPluginShell && (
        <SelectField
          label="Device"
          value={io.inputDeviceId}
          onChange={(e) => io.setInputDevice(e.target.value)}
        >
          <option value="">Default input</option>
          {io.inputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </SelectField>
      )}

      <SelectField
        label="Channel"
        value={io.inputChannel}
        onChange={(e) => io.setInputChannel(e.target.value as InputChannelMode)}
      >
        <option value="l">Ch 1</option>
        <option value="r">Ch 2</option>
        <option value="stereo">Stereo</option>
        <option value="sum">Ch 1+2</option>
      </SelectField>

      {io.micError && <ErrorText>{io.micError}</ErrorText>}
    </Dialog>
  )
}
