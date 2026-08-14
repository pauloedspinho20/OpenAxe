import { useEffect } from 'react'
import { useIOStore } from '../../state/ioStore'
import { Dialog, SelectField } from '../shared'

export interface OutputDeviceDialogProps {
  open: boolean
  onClose: () => void
  outputSelectionSupported: boolean
}

export function OutputDeviceDialog({ open, onClose }: OutputDeviceDialogProps) {
  const io = useIOStore()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <Dialog open={open} onClose={onClose} title="Output" width="min(360px, 90vw)">
      <SelectField
        label="Device"
        value={io.outputDeviceId}
        onChange={(e) => io.setOutputDevice(e.target.value)}
      >
        <option value="">Default output</option>
        {io.outputDevices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </SelectField>
    </Dialog>
  )
}
