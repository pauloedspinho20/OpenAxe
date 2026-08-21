// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TunerDialog } from './TunerDialog'
import { useGraphStore } from '../../../state/graphStore'

describe('components/TunerDialog', () => {
  let setTunerMuted: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setTunerMuted = vi.fn()
    const spy = vi.spyOn(useGraphStore.getState(), 'setTunerMuted')
    spy.mockImplementation(setTunerMuted)
    // vi.spyOn reuses the same spy instance across tests; clear prior calls.
    spy.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the tuner and a muted-while-tuning note when open', () => {
    render(<TunerDialog open onClose={() => {}} analyser={null} />)
    expect(screen.getByText('Tuner')).toBeInTheDocument()
    expect(screen.getByText('Output muted while tuning')).toBeInTheDocument()
  })

  it('mutes the output while open', () => {
    render(<TunerDialog open onClose={() => {}} analyser={null} />)
    expect(setTunerMuted).toHaveBeenCalledWith(true)
  })

  it('unmutes on close', () => {
    render(<TunerDialog open={false} onClose={() => {}} analyser={null} />)
    expect(setTunerMuted).toHaveBeenCalledWith(false)
  })

  it('restores output on unmount while it was open', () => {
    const { unmount } = render(<TunerDialog open onClose={() => {}} analyser={null} />)
    setTunerMuted.mockClear()
    unmount()
    expect(setTunerMuted).toHaveBeenCalledWith(false)
  })
})
