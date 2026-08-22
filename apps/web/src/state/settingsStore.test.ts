// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './settingsStore'

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ open: false, namQuality: 1 })
  })

  it('starts with sensible defaults', () => {
    expect(useSettingsStore.getState().open).toBe(false)
    expect(useSettingsStore.getState().namQuality).toBe(1)
  })

  it('toggles the settings dialog open/closed', () => {
    useSettingsStore.getState().openSettings()
    expect(useSettingsStore.getState().open).toBe(true)
    useSettingsStore.getState().closeSettings()
    expect(useSettingsStore.getState().open).toBe(false)
  })

  it('clamps namQuality into [0.01, 1]', () => {
    useSettingsStore.getState().setNamQuality(2)
    expect(useSettingsStore.getState().namQuality).toBe(1)
    useSettingsStore.getState().setNamQuality(0)
    expect(useSettingsStore.getState().namQuality).toBe(0.01)
    useSettingsStore.getState().setNamQuality(0.5)
    expect(useSettingsStore.getState().namQuality).toBe(0.5)
  })

  it('persists only namQuality (partialize) to localStorage', () => {
    useSettingsStore.getState().setNamQuality(0.42)
    const raw = localStorage.getItem('nam-web-studio-settings')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state).toEqual({ namQuality: 0.42 })
    expect(parsed.state.open).toBeUndefined()
  })
})
