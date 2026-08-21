/**
 * I/O state: device enumeration, input gain/trim, output routing, and
 * latency configuration. Lives outside the engine so it can be configured
 * while the engine is off. Device lists are ephemeral (not persisted) since
 * device IDs change across sessions; selected IDs, gain and latency are
 * persisted so the user's preferences survive reload.
 *
 * Input and output device selections are independent. On the web they map to
 * getUserMedia + setSinkId (two independent choices); on the native desktop
 * shell they map to the C++ core's separate input/output device names
 * (AudioIO::Open accepts createDevice(output_name, input_name)). A previous
 * RtAudio-era restriction (issue #53) forcing a single duplex device is gone
 * since the JUCE backend swap — see apps/desktop/src/audio.cpp.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LatencyHint = 'interactive' | 'balanced' | 'playback'

/** How input channels are routed before hitting the rig. */
export type InputChannelMode = 'l' | 'r' | 'stereo' | 'sum'

export interface IODevice {
  deviceId: string
  label: string
  groupId: string
}

export interface IOState {
  inputDeviceId: string
  outputDeviceId: string
  inputGain: number
  inputChannel: InputChannelMode
  latencyHint: LatencyHint
  micError: string | null
  /** Ephemeral (not persisted) — populated by useAudioIO on mount and on devicechange. */
  inputDevices: IODevice[]
  outputDevices: IODevice[]
}

export interface IOActions {
  setInputDevice: (id: string) => void
  setOutputDevice: (id: string) => void
  setInputGain: (gain: number) => void
  setInputChannel: (mode: InputChannelMode) => void
  setLatencyHint: (hint: LatencyHint) => void
  setMicError: (error: string | null) => void
  /** Populate the device lists from a MediaDevices.enumerateDevices() result. */
  setDeviceLists: (inputs: IODevice[], outputs: IODevice[]) => void
}

type IOStore = IOState & IOActions

const IDLE: IOState = {
  inputDeviceId: '',
  outputDeviceId: '',
  inputGain: 1,
  inputChannel: 'l',
  latencyHint: 'interactive',
  micError: null,
  inputDevices: [],
  outputDevices: [],
}

export const useIOStore = create<IOStore>()(
  persist(
    (set) => ({
      ...IDLE,

      setInputDevice: (inputDeviceId) => set({ inputDeviceId, micError: null }),
      setOutputDevice: (outputDeviceId) => set({ outputDeviceId }),
      setInputGain: (inputGain) => set({ inputGain }),
      setInputChannel: (inputChannel) => set({ inputChannel }),
      setLatencyHint: (latencyHint) => set({ latencyHint }),
      setMicError: (micError) => set({ micError }),
      setDeviceLists: (inputDevices, outputDevices) => set({ inputDevices, outputDevices }),
    }),
    {
      name: 'nam-web-studio-io',
      partialize: (state) => ({
        inputDeviceId: state.inputDeviceId,
        outputDeviceId: state.outputDeviceId,
        inputGain: state.inputGain,
        inputChannel: state.inputChannel,
        latencyHint: state.latencyHint,
      }),
    },
  ),
)
