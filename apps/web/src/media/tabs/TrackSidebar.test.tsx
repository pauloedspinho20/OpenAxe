// @vitest-environment jsdom
import type { model } from '@coderline/alphatab'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrackSidebar, type TrackSidebarProps } from './TrackSidebar'

function makeScore(names: string[]): model.Score {
  return {
    title: 'Test',
    artist: '',
    subTitle: '',
    album: '',
    music: '',
    tab: '',
    tracks: names.map((name, i) => ({
      index: i,
      name,
      playbackInfo: { volume: 12, balance: 8, program: 27 },
      staves: [
        {
          isPercussion: false,
          capo: 0,
          stringTuning: { tunings: [64, 59, 55, 50, 45, 40] },
        },
      ],
    })),
  } as unknown as model.Score
}

function renderSidebar(overrides: Partial<TrackSidebarProps> = {}) {
  const props: TrackSidebarProps = {
    score: makeScore(['Lead', 'Rhythm']),
    trackIndex: 0,
    shown: new Set([0]),
    muted: new Set(),
    solo: new Set(),
    apply: vi.fn(),
    onSelect: vi.fn(),
    onToggleShown: vi.fn(),
    onMute: vi.fn(),
    onSolo: vi.fn(),
    onMove: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  return { ...render(<TrackSidebar {...props} />), props }
}

describe('TrackSidebar', () => {
  it('calls onSelect without calling onToggleShown when clicking a track name', () => {
    const { props } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /^Rhythm/ }))
    expect(props.onSelect).toHaveBeenCalledWith(1)
    expect(props.onToggleShown).not.toHaveBeenCalled()
  })

  it('passes render: false and coalesceKey when adjusting volume/pan and instrument', () => {
    const apply = vi.fn()
    renderSidebar({ apply })

    fireEvent.change(screen.getByRole('slider', { name: 'Lead volume' }), {
      target: { value: '6' },
    })
    expect(apply).toHaveBeenLastCalledWith(expect.any(Function), {
      render: false,
      coalesceKey: 'mix:0:volume',
    })

    fireEvent.change(screen.getByRole('slider', { name: 'Rhythm pan' }), {
      target: { value: '3' },
    })
    expect(apply).toHaveBeenLastCalledWith(expect.any(Function), {
      render: false,
      coalesceKey: 'mix:1:balance',
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'More options' })[0]!)
    fireEvent.click(screen.getByRole('combobox', { name: 'Instrument' }))
    fireEvent.click(screen.getByRole('option', { name: 'Distortion guitar' }))
    expect(apply).toHaveBeenLastCalledWith(expect.any(Function), { render: false })
  })

  it('clarifies show/hide button title and aria-label between solo and multi-track modes', () => {
    const { rerender, props } = renderSidebar({ shown: new Set([0]), trackIndex: 0 })
    const leadBtn = screen.getByRole('button', { name: 'Lead shown in score' })
    expect(leadBtn).toHaveAttribute('title', 'Shown in the score')
    expect(screen.getByRole('button', { name: 'Show Rhythm' })).toHaveAttribute(
      'title',
      'Show in the score',
    )

    rerender(<TrackSidebar {...props} shown={new Set([0, 1])} />)
    expect(screen.getByRole('button', { name: 'Hide Lead' })).toHaveAttribute(
      'title',
      'Hide from the score',
    )
    expect(screen.getByRole('button', { name: 'Hide Rhythm' })).toHaveAttribute(
      'title',
      'Hide from the score',
    )
  })
})
