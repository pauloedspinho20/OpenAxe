import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ButtonGroup } from './ButtonGroup'

describe('ButtonGroup', () => {
  it('renders mode="nav" with aria-current="page" and omits aria-pressed', () => {
    const onChange = vi.fn()
    render(
      <ButtonGroup
        mode="nav"
        label="Views"
        value="rig"
        onChange={onChange}
        items={[
          { value: 'rig', label: 'RIG' },
          { value: 'learn', label: 'LEARN' },
        ]}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Views' })
    const rigBtn = screen.getByRole('button', { name: 'RIG' })
    const learnBtn = screen.getByRole('button', { name: 'LEARN' })
    expect(nav).toContainElement(rigBtn)
    expect(rigBtn).toHaveAttribute('aria-current', 'page')
    expect(rigBtn).not.toHaveAttribute('aria-pressed')
    expect(learnBtn).not.toHaveAttribute('aria-current')

    fireEvent.click(learnBtn)
    expect(onChange).toHaveBeenCalledWith('learn')
  })

  it('supports mode="radiogroup" with roving focus and arrow-key selection', () => {
    const onChange = vi.fn()
    render(
      <ButtonGroup
        mode="radiogroup"
        label="Input mode"
        value="tap"
        onChange={onChange}
        items={[
          { value: 'tap', label: 'Tap' },
          { value: 'midi', label: 'MIDI' },
          { value: 'guitar', label: 'Guitar' },
        ]}
      />,
    )
    const group = screen.getByRole('radiogroup', { name: 'Input mode' })
    const tap = screen.getByRole('radio', { name: 'Tap' })
    const midi = screen.getByRole('radio', { name: 'MIDI' })
    const guitar = screen.getByRole('radio', { name: 'Guitar' })

    expect(group).toContainElement(tap)
    expect(tap).toHaveAttribute('aria-checked', 'true')
    expect(tap).toHaveAttribute('tabindex', '0')
    expect(midi).toHaveAttribute('aria-checked', 'false')
    expect(midi).toHaveAttribute('tabindex', '-1')

    tap.focus()
    fireEvent.keyDown(tap, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(midi)
    expect(onChange).toHaveBeenCalledWith('midi')

    fireEvent.keyDown(midi, { key: 'End' })
    expect(document.activeElement).toBe(guitar)
    expect(onChange).toHaveBeenCalledWith('guitar')
  })

  it('supports mode="tablist" with aria-selected and skips disabled tabs on arrow keys', () => {
    const onChange = vi.fn()
    render(
      <ButtonGroup
        mode="tablist"
        label="Sections"
        value="tracks"
        onChange={onChange}
        items={[
          { value: 'tracks', label: 'Tracks', badge: 2 },
          { value: 'practice', label: 'Practice', disabled: true },
          { value: 'tone', label: 'Tone' },
        ]}
      />,
    )
    const tablist = screen.getByRole('tablist', { name: 'Sections' })
    const tracks = screen.getByRole('tab', { name: /Tracks/ })
    const tone = screen.getByRole('tab', { name: 'Tone' })

    expect(tablist).toContainElement(tracks)
    expect(tracks).toHaveAttribute('aria-selected', 'true')
    expect(tone).toHaveAttribute('aria-selected', 'false')

    tracks.focus()
    fireEvent.keyDown(tracks, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tone)
    expect(onChange).toHaveBeenCalledWith('tone')
  })

  it('omits aria-pressed in action-only group mode without value', () => {
    const onChange = vi.fn()
    render(
      <ButtonGroup
        label="Positions"
        onChange={onChange}
        items={[
          { value: '0-5', label: '0–5' },
          { value: '5-12', label: '5–12' },
        ]}
      />,
    )
    const first = screen.getByRole('button', { name: '0–5' })
    expect(first).not.toHaveAttribute('aria-pressed')
    fireEvent.click(first)
    expect(onChange).toHaveBeenCalledWith('0-5')
  })

  it('marks aria-pressed="false" on all items when value is null', () => {
    render(
      <ButtonGroup
        label="Categories"
        value={null}
        onChange={() => {}}
        items={[{ value: 'note', label: 'Note' }]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Note' })).toHaveAttribute('aria-pressed', 'false')
  })
})
