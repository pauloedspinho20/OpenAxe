// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FretboardPanel } from './FretboardPanel'

const STD = [64, 59, 55, 50, 45, 40]

function renderNeck(frets?: number) {
  const onFret = vi.fn()
  const view = render(
    <FretboardPanel
      tunings={STD}
      capo={0}
      {...(frets !== undefined ? { frets } : {})}
      cursorString={1}
      cursorNotes={[]}
      playingNotes={[]}
      onFret={onFret}
      onPitch={vi.fn()}
      stepInput="off"
      onStepInput={vi.fn()}
      stepAdvance={true}
      onStepAdvance={vi.fn()}
      defaultMode="neck"
    />,
  )
  return { ...view, onFret }
}

describe('FretboardPanel', () => {
  it('renders single and double inlay markers at frets 5, 7, 9, 12, 15, 17, 19, 21, and 24', () => {
    const { container } = renderNeck()
    const slots = [...container.querySelectorAll<HTMLElement>('[data-inlay-fret]')]

    expect(slots.map((el) => Number(el.dataset.inlayFret))).toEqual([
      5, 7, 9, 12, 15, 17, 19, 21, 24,
    ])

    for (const slot of slots) {
      const fret = Number(slot.dataset.inlayFret)
      const expectedDouble = fret % 12 === 0
      expect(slot.dataset.inlay).toBe(expectedDouble ? 'double' : 'single')
      expect(slot.children).toHaveLength(expectedDouble ? 2 : 1)
    }
  })

  it('caps rendered inlay markers when the neck has fewer frets', () => {
    const { container } = renderNeck(15)
    const slots = [...container.querySelectorAll<HTMLElement>('[data-inlay-fret]')]
    expect(slots.map((el) => Number(el.dataset.inlayFret))).toEqual([5, 7, 9, 12, 15])
  })

  it('keeps inlaid fret buttons interactive', () => {
    const { onFret } = renderNeck()
    fireEvent.click(screen.getByRole('gridcell', { name: /String 6 fret 5 \(A2\)/ }))
    expect(onFret).toHaveBeenCalledWith({ string: 1, fret: 5 })
  })

  it('draws string gauges increasing from top (high E) to bottom (low E)', () => {
    const { container } = renderNeck()
    const rows = [...container.querySelectorAll<HTMLElement>('[role="grid"] > [role="row"]')]
    expect(rows).toHaveLength(6)

    const gauges = rows.map((row) => {
      const stringEl = row.querySelector<HTMLElement>('[class*="fretString"]')
      expect(stringEl).not.toBeNull()
      return Number.parseFloat(stringEl!.style.height)
    })

    expect(gauges).toEqual([1, 1.35, 1.7, 2.05, 2.4, 2.75])
  })
})
