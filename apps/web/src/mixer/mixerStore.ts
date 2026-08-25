import { create } from 'zustand'

export interface MixerBusState {
  gain: number
  pan: number
  muted: boolean
  soloed: boolean
  meter: number
}

interface MixerState {
  buses: Record<number, MixerBusState>
  setGain: (bus: number, gain: number) => void
  setPan: (bus: number, pan: number) => void
  setMute: (bus: number, muted: boolean) => void
  setSolo: (bus: number, soloed: boolean) => void
  setMeter: (bus: number, meter: number) => void
}

const DEFAULT_BUS: MixerBusState = { gain: 1, pan: 0, muted: false, soloed: false, meter: 0 }

function busOrDefault(buses: Record<number, MixerBusState>, bus: number): MixerBusState {
  return buses[bus] ?? DEFAULT_BUS
}

export const useMixerStore = create<MixerState>()((set) => ({
  buses: {},

  setGain: (bus, gain) => {
    set((s) => ({ buses: { ...s.buses, [bus]: { ...busOrDefault(s.buses, bus), gain } } }))
  },
  setPan: (bus, pan) => {
    set((s) => ({ buses: { ...s.buses, [bus]: { ...busOrDefault(s.buses, bus), pan } } }))
  },
  setMute: (bus, muted) => {
    set((s) => ({ buses: { ...s.buses, [bus]: { ...busOrDefault(s.buses, bus), muted } } }))
  },
  setSolo: (bus, soloed) => {
    set((s) => ({ buses: { ...s.buses, [bus]: { ...busOrDefault(s.buses, bus), soloed } } }))
  },
  setMeter: (bus, meter) => {
    set((s) => ({ buses: { ...s.buses, [bus]: { ...busOrDefault(s.buses, bus), meter } } }))
  },
}))

// Poll bus meters from the core (like GraphRig's meter poll). Pass the rig explicitly.
export function startMixerMeterPoll(
  getRig: () => { getBusMeter: (bus: number) => Promise<number> } | null,
  intervalMs = 50,
): () => void {
  const id = setInterval(async () => {
    const rig = getRig()
    if (!rig) return
    for (let bus = 0; bus < 10; bus++) {
      try {
        const meter = await rig.getBusMeter(bus)
        useMixerStore.getState().setMeter(bus, meter)
      } catch {
        // ignore
      }
    }
  }, intervalMs)
  return () => clearInterval(id)
}
