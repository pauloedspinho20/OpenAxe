/**
 * Enumerates audio input/output devices on mount and listens for hot-plug
 * events (devicechange). Populates the ioStore with device lists and
 * auto-resets input selection to default if the chosen device disappears.
 */
import { useCallback, useEffect, useRef } from 'react'
import { getNamStudio } from '../native/namStudio'
import type { NamStudioDevice } from '../native/namStudio'
import { useIOStore } from '../state/ioStore'

function mapDevice(device: MediaDeviceInfo) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Audio ${device.deviceId.slice(0, 6)}…`,
    groupId: device.groupId,
  }
}

function mapNativeDevice(device: NamStudioDevice) {
  return {
    deviceId: String(device.id),
    label: device.name || 'Default',
    groupId: device.api,
  }
}

/** Populate ioStore from the native bridge's RtAudio devices. Returns true if handled. */
async function enumerateNative(): Promise<boolean> {
  const bridge = getNamStudio()
  if (!bridge) return false
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
    // In the desktop shell the device list comes from RtAudio (window.namStudio),
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
    if (getNamStudio()) return // native devices don't emit devicechange; no hot-plug listener
    if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') return
    if (!enumeratedRef.current) {
      enumeratedRef.current = true
      void enumerate()
    }

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
    !getNamStudio() && typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

  return { outputSelectionSupported }
}
