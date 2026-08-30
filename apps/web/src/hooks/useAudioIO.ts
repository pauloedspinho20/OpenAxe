/**
 * Enumerates audio input/output devices on mount and listens for hot-plug
 * events (devicechange). Populates the ioStore with device lists and
 * auto-resets input selection to default if the chosen device disappears.
 */
import { useCallback, useEffect, useRef } from 'react'
import { getOpenAxe, shellOwnsAudioDevice } from '../native/openaxe'
import type { OpenAxeDevice } from '../native/openaxe'
import { useIOStore } from '../state/ioStore'

function mapDevice(device: MediaDeviceInfo) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Audio ${device.deviceId.slice(0, 6)}…`,
    groupId: device.groupId,
  }
}

function mapNativeDevice(device: OpenAxeDevice) {
  return {
    deviceId: String(device.id),
    label: device.name || 'Default',
    groupId: device.api,
  }
}

/** Populate ioStore from the native bridge's RtAudio devices. Returns true if handled. */
async function enumerateNative(): Promise<boolean> {
  const bridge = getOpenAxe()
  if (!bridge) return false
  // In a plugin the DAW owns device selection, and the bridge answers
  // listDevices with an empty array. Returning true (handled) rather than
  // falling through stops us from asking the browser instead - which is what
  // opened a getUserMedia permission prompt inside the host (issue #300 E1).
  if (!shellOwnsAudioDevice()) {
    useIOStore.getState().setDeviceLists([], [])
    return true
  }
  try {
    const devices = await bridge.listDevices()
    useIOStore
      .getState()
      .setDeviceLists(
        devices.filter((d) => d.isInput).map(mapNativeDevice),
        devices.filter((d) => d.isOutput).map(mapNativeDevice),
      )
    return true
  } catch (err) {
    console.warn('[useAudioIO] native device enumeration failed:', err)
    return false
  }
}

export function useAudioIO() {
  const enumeratedRef = useRef(false)

  const enumerate = useCallback(async () => {
    // In the desktop shell the device list comes from RtAudio (window.openAxe),
    // not the browser's MediaDevices.
    if (await enumerateNative()) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput').map(mapDevice)
      const outputs = all.filter((d) => d.kind === 'audiooutput').map(mapDevice)
      const io = useIOStore.getState()

      // If the selected device disappeared, fall back to default.
      const inputStillExists =
        io.inputDeviceId === '' || inputs.some((d) => d.deviceId === io.inputDeviceId)
      if (!inputStillExists) {
        io.setInputDevice('')
        io.setMicError('Selected input device disconnected — switched to default.')
      }

      io.setDeviceLists(inputs, outputs)
    } catch (err) {
      // enumerateDevices may fail in insecure contexts — that's fine, the
      // input selector will just show "Default" with no label.
      console.warn('[useAudioIO] enumerateDevices failed:', err)
    }
  }, [])

  useEffect(() => {
    // Populate the device list once on mount in every mode. In the desktop
    // shell this is the only way the native device list reaches the UI -
    // enumerate() routes through enumerateNative() (bridge.listDevices()),
    // and the C++ side already knows about the real hardware.
    if (!enumeratedRef.current) {
      enumeratedRef.current = true
      void enumerate()
    }

    // Browser hot-plug detection only exists for the web MediaDevices API.
    // Native (desktop) devices don't emit devicechange, so there's no listener
    // to attach there.
    if (getOpenAxe()) return
    if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') return

    // Re-enumerate on hot-plug.
    try {
      navigator.mediaDevices.addEventListener('devicechange', enumerate)
      return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
    } catch {
      // devicechange not supported — no-op.
    }
  }, [enumerate])

  /**
   * Whether the output device selector is usable in the current browser.
   * Native output routing is owned by the C++ shell, so this is false there.
   */
  const outputSelectionSupported =
    !getOpenAxe() && typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

  return { outputSelectionSupported }
}
