import { useEffect } from 'react'
import { useIOStore, type InputChannelMode } from '../../../state/ioStore'
import { useDIAuditionStore } from '../../../state/diAuditionStore'
import { DI_SAMPLES } from '../../../diSamples'
import type { AudioEngineState, AudioEngineActions } from '../../../hooks/useAudioEngine'
import { getShellKind } from '../../../native/openaxe'
import { Dialog, SelectField, ErrorText, Hint, HardwareButton } from '@openaxe/ui'
import { PauseIcon, PlayIcon } from '../../../../../../packages/ui/src/icons/GeneraIcons'

export interface InputDeviceDialogProps {
  open: boolean
  onClose: () => void
  engine: AudioEngineState & AudioEngineActions
}

export function InputDeviceDialog({ open, onClose, engine }: InputDeviceDialogProps) {
  const io = useIOStore()
  const { selectedId, setSelectedId } = useDIAuditionStore()
  const diPlaying = engine.diPlaying ?? false
  const diError = engine.diError ?? null
  const diSampleId = engine.diSampleId ?? null
  const engineReady = engine.status === 'ready'
  const playDI = engine.playDI
  const stopDI = engine.stopDI
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

  // If engine powers off, ensure DI stops (extra safety; engine already does).
  useEffect(() => {
    if (engine.status !== 'ready' && diPlaying) stopDI?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.status])

  const guitarSamples = DI_SAMPLES.filter((s) => s.instrument === 'guitar')
  const bassSamples = DI_SAMPLES.filter((s) => s.instrument === 'bass')

  const effectiveSelected = selectedId ?? diSampleId ?? 'guitar-clean'
  const canPlay = engineReady && !!effectiveSelected && !!playDI && !!stopDI

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
    } else if (effectiveSelected && playDI) {
      void playDI(effectiveSelected)
    }
  }

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

      {/* DI audition — bundled samples that loop through the rig, muting live mic */}

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

      <HardwareButton
        label={diPlaying ? 'Pause' : 'Play'}
        icon={diPlaying ? <PauseIcon /> : <PlayIcon />}
        onClick={handlePlayPause}
        disabled={!canPlay}
        active={diPlaying}
        aria-pressed={diPlaying}
        aria-label={diPlaying ? 'Pause DI sample' : 'Play DI sample'}
        title={
          !engineReady
            ? 'Engine not ready'
            : diPlaying
              ? 'Pause — restores live input'
              : 'Play — mutes live input, loops through rig'
        }
      ></HardwareButton>

      {diPlaying && <Hint>Playing DI — live input muted</Hint>}
      {diError && <ErrorText>{diError}</ErrorText>}
      {io.micError && <ErrorText>{io.micError}</ErrorText>}
    </Dialog>
  )
}
