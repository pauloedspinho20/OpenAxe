import { useEffect, useMemo } from 'react'
import { useIOStore } from '../../../state/ioStore'
import styles from './OutputDeviceDialog.module.css'
import { Dialog, HardwareButton, Select } from '@openaxe/ui'
import { useGraphStore } from '../../../state/graphStore'
import {
  BlockSpectrum,
  masterSpectrumSource,
  type MasterSpectrumRig,
} from '../BlockSpectrum/BlockSpectrum'

export interface OutputDeviceDialogProps {
  open: boolean
  onClose: () => void
  outputSelectionSupported: boolean
  /** The rig whose master bus feeds the spectrum; omit and the spectrum is hidden. */
  rig?: MasterSpectrumRig | null
}

export function OutputDeviceDialog({ open, onClose, rig }: OutputDeviceDialogProps) {
  const io = useIOStore()
  const masterMuted = useGraphStore((s) => s.masterMuted)
  const setMasterMuted = useGraphStore((s) => s.setMasterMuted)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const source = useMemo(() => (open && rig ? masterSpectrumSource(rig) : null), [open, rig])

  return (
    <Dialog open={open} onClose={onClose} title="Output" width="min(720px, 94vw)">
      <div className={styles.row}>
        <Select
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
        </Select>
        <HardwareButton
          label="MUTE"
          active={masterMuted}
          title="Mute the output (the spectrum below keeps showing the signal)"
          onClick={() => setMasterMuted(!masterMuted)}
        />
      </div>
      {rig && <BlockSpectrum source={source} />}
    </Dialog>
  )
}
