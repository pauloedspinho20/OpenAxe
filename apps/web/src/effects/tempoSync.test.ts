import { describe, expect, it } from 'vitest'
import { tempoSyncedParams } from './tempoSync'

describe('tempoSyncedParams', () => {
  it('syncs delay time in ms', () => {
    expect(tempoSyncedParams('delay', { tempoSync: '1/4', time: 300 }, 120)).toEqual({ time: 500 })
    expect(tempoSyncedParams('delay', { tempoSync: '1/8d', time: 300 }, 120)).toEqual({ time: 375 })
  })

  it('syncs LFO rate in Hz', () => {
    expect(tempoSyncedParams('tremolo', { tempoSync: '1/4', rate: 4 }, 120)).toEqual({ rate: 2 })
  })

  it('clamps to the core range', () => {
    const slow = tempoSyncedParams('delay', { tempoSync: '1/1', time: 300 }, 30)
    expect(slow!.time).toBeLessThan(8000)
    const fast = tempoSyncedParams('tremolo', { tempoSync: '1/16', rate: 4 }, 300)
    expect(fast!.rate).toBeLessThanOrEqual(20)
  })

  it('does nothing when off, unsupported, or already in sync', () => {
    expect(tempoSyncedParams('delay', { tempoSync: 'off', time: 300 }, 120)).toBeNull()
    expect(tempoSyncedParams('delay', { time: 300 }, 120)).toBeNull()
    expect(tempoSyncedParams('reverb', { tempoSync: '1/4' }, 120)).toBeNull()
    expect(tempoSyncedParams('delay', { tempoSync: '1/4', time: 500 }, 120)).toBeNull()
  })
})
