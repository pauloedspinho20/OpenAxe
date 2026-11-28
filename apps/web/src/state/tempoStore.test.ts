import { beforeEach, describe, expect, it } from 'vitest'
import {
  bpmFromTaps,
  clampBpm,
  divisionToHz,
  divisionToMs,
  resetTapsForTest,
  useTempoStore,
} from './tempoStore'

describe('tempoStore', () => {
  beforeEach(() => {
    resetTapsForTest()
    useTempoStore.setState({ bpm: 120, metronomeOn: false, metronomeVolume: 0.5 })
  })

  it('clamps and rounds bpm', () => {
    expect(clampBpm(5)).toBe(30)
    expect(clampBpm(999)).toBe(300)
    expect(clampBpm(100.04)).toBe(100)
    expect(clampBpm(102.9)).toBe(103)
    expect(clampBpm(NaN)).toBe(120)
  })

  it('derives bpm from tap intervals', () => {
    expect(bpmFromTaps([0])).toBeNull()
    expect(bpmFromTaps([0, 500, 1000, 1500])).toBe(120)
    expect(Number.isInteger(bpmFromTaps([0, 585, 1170])!)).toBe(true) // 102.56 -> 103
  })

  it('tap sets bpm from the second tap and restarts after a pause', () => {
    const { tap } = useTempoStore.getState()
    tap(0)
    expect(useTempoStore.getState().bpm).toBe(120)
    tap(600)
    expect(useTempoStore.getState().bpm).toBe(100)
    tap(10_000)
    expect(useTempoStore.getState().bpm).toBe(100) // new sequence, one tap: unchanged
    tap(10_500)
    expect(useTempoStore.getState().bpm).toBe(120)
  })

  it('clamps the metronome volume', () => {
    useTempoStore.getState().setMetronomeVolume(3)
    expect(useTempoStore.getState().metronomeVolume).toBe(1)
    useTempoStore.getState().setMetronomeVolume(-1)
    expect(useTempoStore.getState().metronomeVolume).toBe(0)
  })

  it('converts note divisions', () => {
    expect(divisionToMs(120, '1/4')).toBe(500)
    expect(divisionToMs(120, '1/8d')).toBe(375)
    expect(divisionToHz(120, '1/4')).toBe(2)
  })
})
