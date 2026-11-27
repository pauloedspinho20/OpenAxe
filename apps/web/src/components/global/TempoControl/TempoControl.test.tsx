import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TempoControl } from './TempoControl'
import { resetTapsForTest, useTempoStore } from '../../../state/tempoStore'

vi.mock('../../../audio/metronome', () => ({
  Metronome: class {
    start = vi.fn()
    stop = vi.fn()
    dispose = vi.fn()
  },
}))

describe('TempoControl', () => {
  beforeEach(() => {
    resetTapsForTest()
    useTempoStore.setState({ bpm: 120, metronomeOn: false, metronomeVolume: 0.5 })
  })

  it('steps the shared bpm', () => {
    render(<TempoControl />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase tempo' }))
    expect(useTempoStore.getState().bpm).toBe(121)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease tempo' }))
    expect(useTempoStore.getState().bpm).toBe(120)
  })

  it('reflects bpm changed elsewhere (other screens share the store)', () => {
    render(<TempoControl />)
    act(() => useTempoStore.getState().setBpm(90))
    expect((screen.getByRole('textbox', { name: 'BPM' }) as HTMLInputElement).value).toBe('90')
  })

  it('commits a typed bpm on Enter, clamps it, and discards on Escape', () => {
    render(<TempoControl />)
    const input = screen.getByRole('textbox', { name: 'BPM' })
    fireEvent.change(input, { target: { value: '93' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useTempoStore.getState().bpm).toBe(93)
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.blur(input)
    expect(useTempoStore.getState().bpm).toBe(300)
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useTempoStore.getState().bpm).toBe(300)
  })

  it('toggles the metronome', () => {
    render(<TempoControl />)
    fireEvent.click(screen.getByRole('button', { name: /metro/i }))
    expect(useTempoStore.getState().metronomeOn).toBe(true)
  })
})
