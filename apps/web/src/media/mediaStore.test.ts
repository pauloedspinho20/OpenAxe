import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMediaStore } from './mediaStore'
import type { BackingTransport, PlayerStatus } from './transport'

function fakeTransport() {
  let status: PlayerStatus = {
    position: 0,
    length: 48_000 * 10,
    sampleRate: 48_000,
    playing: false,
    meter: 0,
  }
  const ok = async () => status
  const t: BackingTransport & { set(s: Partial<PlayerStatus>): void } = {
    load: vi.fn(async () => status),
    unload: vi.fn(async () => {}),
    play: vi.fn(async () => (status = { ...status, playing: true })),
    pause: vi.fn(async () => (status = { ...status, playing: false })),
    seek: vi.fn(async (frame: number) => (status = { ...status, position: frame })),
    setSpeed: vi.fn(ok),
    setSemitones: vi.fn(ok),
    setVolume: vi.fn(ok),
    setLoop: vi.fn(ok),
    status: vi.fn(ok),
    set(s) {
      status = { ...status, ...s }
    },
  }
  return t
}

const track = { channels: [new Float32Array(10)], sampleRate: 48_000, frames: 48_000 * 10 }

describe('media store', () => {
  beforeEach(() => {
    useMediaStore.setState({
      transport: null,
      loaded: null,
      loadState: 'idle',
      prepare: null,
      practice: {
        speed: 1,
        semitones: 0,
        volume: 1,
        loopStart: null,
        loopEnd: null,
        loopEnabled: false,
      },
      trainer: { enabled: false, step: 0.05, every: 2, target: 1 },
      loopCount: 0,
      position: 0,
      playing: false,
    })
  })

  it('loads decoded audio, applies practice settings and plays', async () => {
    const t = fakeTransport()
    useMediaStore.getState().setTransport(t)
    useMediaStore.setState({
      practice: { ...useMediaStore.getState().practice, speed: 0.7, semitones: -2 },
    })
    await useMediaStore.getState().loadDecoded('x', track, 1)
    const s = useMediaStore.getState()
    expect(s.loadState).toBe('ready')
    expect(s.duration).toBe(10)
    expect(t.setSpeed).toHaveBeenCalledWith(0.7)
    expect(t.setSemitones).toHaveBeenCalledWith(-2)
    await s.play()
    expect(useMediaStore.getState().playing).toBe(true)
    await useMediaStore.getState().seek(2.5)
    expect(t.seek).toHaveBeenCalledWith(120_000)
  })

  it('clamps controls and orders loop points', async () => {
    const t = fakeTransport()
    useMediaStore.getState().setTransport(t)
    await useMediaStore.getState().loadDecoded('x', track, 1)
    const s = useMediaStore.getState()
    s.setSpeed(5)
    expect(useMediaStore.getState().practice.speed).toBe(2)
    s.setSemitones(-20)
    expect(useMediaStore.getState().practice.semitones).toBe(-12)
    s.setLoopPoint('start', 6)
    s.setLoopPoint('end', 2)
    const p = useMediaStore.getState().practice
    expect([p.loopStart, p.loopEnd, p.loopEnabled]).toEqual([2, 6, true])
    expect(t.setLoop).toHaveBeenLastCalledWith(96_000, 288_000, true)
  })

  it('runs the speed trainer on each loop pass', async () => {
    const t = fakeTransport()
    useMediaStore.getState().setTransport(t)
    await useMediaStore.getState().loadDecoded('x', track, 1)
    const s = useMediaStore.getState()
    s.setSpeed(0.8)
    s.setLoop(2, 4, true)
    s.setTrainer({ enabled: true, step: 0.05, every: 1, target: 0.9 })
    useMediaStore.setState({ playing: true, position: 3.9 })
    // The core reports the position jumping back to the loop start.
    s.applyStatus({
      position: 2.05 * 48_000,
      length: 480_000,
      sampleRate: 48_000,
      playing: true,
      meter: 0,
    })
    expect(useMediaStore.getState().loopCount).toBe(1)
    expect(useMediaStore.getState().practice.speed).toBeCloseTo(0.85)
  })

  it('drops the loaded track when the engine (transport) changes', async () => {
    const t = fakeTransport()
    useMediaStore.getState().setTransport(t)
    await useMediaStore.getState().loadDecoded('x', track, 1)
    useMediaStore.getState().setTransport(fakeTransport())
    expect(useMediaStore.getState().loaded).toBeNull()
    expect(useMediaStore.getState().loadState).toBe('idle')
  })
})
