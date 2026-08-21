// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnboarding } from './useOnboarding'

describe('hooks/useOnboarding', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is open on first run (not yet dismissed)', () => {
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.open).toBe(true)
  })

  it('is closed when the dismissal is already stored', () => {
    localStorage.setItem('nam-web-studio:onboarding-dismissed', '1')
    const { result } = renderHook(() => useOnboarding())
    expect(result.current.open).toBe(false)
  })

  it('closes and persists the dismissal', () => {
    const { result } = renderHook(() => useOnboarding())
    act(() => result.current.dismiss())
    expect(result.current.open).toBe(false)
    expect(localStorage.getItem('nam-web-studio:onboarding-dismissed')).toBe('1')
  })
})
