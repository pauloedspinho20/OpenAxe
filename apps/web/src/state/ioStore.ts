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
import { resolveSelectedInputLabel } from '../audio/detectRiskyInput'

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
  /**
   * Feedback-guard acknowledgement (issue #422), session-scoped and never
   * persisted: which input selection the user explicitly accepted the
   * built-in-mic feedback risk for, as an (inputDeviceId, label) snapshot.
   * Matching is per-device — switching input, or labels resolving after mic
   * permission is granted, invalidates the snapshot and re-arms the guard.
   * Device ids are ephemeral across sessions anyway, so persisting this would
   * be both useless and wrong (a stale ack silently blessing a new device).
   */
  micRiskAckDeviceId: string | null
  micRiskAckLabel: string | null
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
  /**
   * Record (`true`) or revoke (`false`) the feedback-risk acknowledgement for
   * the *current* input selection. Recording snapshots the selection, so a
   * later device change re-arms the guard instead of inheriting consent.
   */
  setMicRiskAcknowledged: (acknowledged: boolean) => void
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
  micRiskAckDeviceId: null,
  micRiskAckLabel: null,
  inputDevices: [],
  outputDevices: [],
}

export const useIOStore = create<IOStore>()(
  persist(
    (set, get) => ({
      ...IDLE,

      setInputDevice: (inputDeviceId) => set({ inputDeviceId, micError: null }),
      setOutputDevice: (outputDeviceId) => set({ outputDeviceId }),
      setInputGain: (inputGain) => set({ inputGain }),
      setInputChannel: (inputChannel) => set({ inputChannel }),
      setLatencyHint: (latencyHint) => set({ latencyHint }),
      setMicError: (micError) => set({ micError }),
      setMicRiskAcknowledged: (acknowledged) =>
        set(
          acknowledged
            ? {
                micRiskAckDeviceId: get().inputDeviceId,
                micRiskAckLabel: resolveSelectedInputLabel(get().inputDeviceId, get().inputDevices),
              }
            : { micRiskAckDeviceId: null, micRiskAckLabel: null },
        ),
      setDeviceLists: (inputDevices, outputDevices) => set({ inputDevices, outputDevices }),
    }),
    {
      name: 'openaxe-io',
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
