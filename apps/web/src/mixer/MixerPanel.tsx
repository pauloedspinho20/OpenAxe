import { useEffect } from 'react'
import { useMixerStore, startMixerMeterPoll } from './mixerStore'
import { useAudioEngine } from '../hooks/useAudioEngine'
import { Fader, Knob, Meter, HardwareButton } from '@openaxe/ui'
import styles from './MixerPanel.module.css'

const BUS_LABELS: Record<number, string> = {
  0: 'Song',
  1: 'Grid',
  2: 'Take 1',
  3: 'Take 2',
  4: 'Take 3',
  5: 'Take 4',
  6: 'Take 5',
  7: 'Take 6',
  8: 'Take 7',
  9: 'Take 8',
}

function BusStrip({ bus }: { bus: number }) {
  const { rig } = useAudioEngine()
  const busState = useMixerStore((s) => s.buses[bus] ?? { gain: 1, pan: 0, muted: false, soloed: false, meter: 0 })
  const setGain = useMixerStore((s) => s.setGain)
  const setPan = useMixerStore((s) => s.setPan)
  const setMute = useMixerStore((s) => s.setMute)
  const setSolo = useMixerStore((s) => s.setSolo)

  const handleGain = (gain: number) => {
    rig?.setBusGain(bus, gain)
    setGain(bus, gain)
  }
  const handlePan = (pan: number) => {
    rig?.setBusPan(bus, pan)
    setPan(bus, pan)
  }
  const handleMute = () => {
    const next = !busState.muted
    rig?.setBusMute(bus, next)
    setMute(bus, next)
  }
  const handleSolo = () => {
    const next = !busState.soloed
    rig?.setBusSolo(bus, next)
    setSolo(bus, next)
  }

  return (
    <div className={styles.strip} data-bus={bus}>
      <div className={styles.label}>{BUS_LABELS[bus] ?? `Bus ${bus}`}</div>
      <Meter level={busState.meter} label="Peak" />
      <Fader label="Gain" value={busState.gain} min={0} max={1.5} step={0.01} onChange={handleGain} formatValue={(v) => v.toFixed(2)} />
      <Knob label="Pan" value={busState.pan} min={-1} max={1} step={0.01} onChange={handlePan} />
      <div className={styles.buttons}>
        <HardwareButton label={busState.muted ? 'Unmute' : 'Mute'} active={busState.muted} onClick={handleMute} />
        <HardwareButton label={busState.soloed ? 'Unsolo' : 'Solo'} active={busState.soloed} onClick={handleSolo} />
      </div>
    </div>
  )
}

export function MixerPanel() {
  const { rig, status } = useAudioEngine()
  const isReady = status === 'ready'

  useEffect(() => {
    if (!isReady || !rig) return
    const stop = startMixerMeterPoll(() => rig)
    return stop
  }, [isReady, rig])

  if (!isReady) return null

  return (
    <div className={styles.panel} role="region" aria-label="Session mixer">
      <div className={styles.header}>MIXER — Song / Grid / Takes</div>
      <div className={styles.strips}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((bus) => (
          <BusStrip key={bus} bus={bus} />
        ))}
      </div>
    </div>
  )
}
