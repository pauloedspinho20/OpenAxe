/**
 * Enumerates audio input/output devices on mount and listens for hot-plug
 * events (devicechange). Populates the ioStore with device lists and
 * auto-resets input selection to default if the chosen device disappears.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useIOStore } from '../state/ioStore'

function mapDevice(device: MediaDeviceInfo) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Audio ${device.deviceId.slice(0, 6)}…`,
    groupId: device.groupId,
  }
}

export function useAudioIO() {
  const store = useIOStore()
  const enumeratedRef = useRef(false)

  const enumerate = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput').map(mapDevice)
      const outputs = all.filter((d) => d.kind === 'audiooutput').map(mapDevice)
      const currentInput = useIOStore.getState().inputDeviceId

      // If the selected device disappeared, fall back to default.
      const inputStillExists =
        currentInput === '' || inputs.some((d) => d.deviceId === currentInput)
      if (!inputStillExists) {
        store.setInputDevice('')
        store.setMicError('Selected input device disconnected — switched to default.')
      }

      store.setDeviceLists(inputs, outputs)
    } catch (err) {
      // enumerateDevices may fail in insecure contexts — that's fine, the
      // input selector will just show "Default" with no label.
      console.warn('[useAudioIO] enumerateDevices failed:', err)
    }
  }, [store])

  useEffect(() => {
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
   * AudioContext.setSinkId is supported in Chrome 110+ and Edge.
   */
  const outputSelectionSupported =
    typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

  return { outputSelectionSupported }
}
