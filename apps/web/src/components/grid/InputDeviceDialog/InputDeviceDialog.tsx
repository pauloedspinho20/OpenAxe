import { useEffect } from 'react'
import { useIOStore, type InputChannelMode } from '../../../state/ioStore'
import { useDIAuditionStore } from '../../../state/diAuditionStore'
import { DI_SAMPLES } from '../../../diSamples'
import { useAudioEngine } from '../../../hooks/useAudioEngine'
import { Dialog, SelectField, ErrorText, Hint, OutlineButton } from '@openaxe/ui'

export interface InputDeviceDialogProps {
  open: boolean
  onClose: () => void
}

export function InputDeviceDialog({ open, onClose }: InputDeviceDialogProps) {
  const io = useIOStore()
  const { selectedId, setSelectedId } = useDIAuditionStore()
  const engine = useAudioEngine()
  const diPlaying = (engine as unknown as { diPlaying?: boolean }).diPlaying ?? false
  const diError = (engine as unknown as { diError?: string | null }).diError ?? null
  const diSampleId = (engine as unknown as { diSampleId?: string | null }).diSampleId ?? null
  const engineReady = engine.status === 'ready'
  const playDI = (engine as unknown as { playDI?: (id: string) => Promise<void> }).playDI
  const stopDI = (engine as unknown as { stopDI?: () => void }).stopDI

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Stop DI when dialog closes (all-triggers: dialog close restores mic).
  useEffect(() => {
    if (!open && diPlaying) stopDI?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // If engine powers off, ensure DI stops (extra safety; engine already does).
  useEffect(() => {
    if (engine.status !== 'ready' && diPlaying) stopDI?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.status])

  const guitarSamples = DI_SAMPLES.filter((s) => s.instrument === 'guitar')
  const bassSamples = DI_SAMPLES.filter((s) => s.instrument === 'bass')

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null
    setSelectedId(id as typeof selectedId)
    // If currently playing, switch to the new sample immediately.
    if (diPlaying && id && playDI) {
      void playDI(id)
    }
  }

  const handlePlayPause = () => {
    if (diPlaying) {
      stopDI?.()
    } else if (selectedId && playDI) {
      void playDI(selectedId)
    }
  }

  const effectiveSelected = selectedId ?? diSampleId ?? 'guitar-clean'
  const canPlay = engineReady && !!effectiveSelected && !!playDI && !!stopDI

  return (
    <Dialog open={open} onClose={onClose} title="Input" width="min(360px, 90vw)">
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

      {/* DI audition — bundled samples that loop through the rig, muting live mic */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <SelectField
            label="DI Sample"
            value={effectiveSelected}
            onChange={handleSelectChange}
            disabled={!engineReady}
            title={DI_SAMPLES.find((s) => s.id === effectiveSelected)?.description}
          >
            <optgroup label="Guitar">
              {guitarSamples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Bass">
              {bassSamples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          </SelectField>
        </div>
        <OutlineButton
          onClick={handlePlayPause}
          disabled={!canPlay}
          aria-pressed={diPlaying}
          aria-label={diPlaying ? 'Pause DI sample' : 'Play DI sample'}
          title={
            !engineReady
              ? 'Engine not ready'
              : diPlaying
                ? 'Pause — restores live input'
                : 'Play — mutes live input, loops through rig'
          }
          style={{ minWidth: 86, height: 'var(--input-height)' }}
        >
          {diPlaying ? '⏸ Pause' : '▶ Play'}
        </OutlineButton>
      </div>

      {diPlaying && <Hint>Playing DI — live input muted</Hint>}
      {diError && <ErrorText>{diError}</ErrorText>}
      {io.micError && <ErrorText>{io.micError}</ErrorText>}
    </Dialog>
  )
}
