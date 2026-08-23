// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { JackDisconnect } from './JackDisconnect'

describe('JackDisconnect', () => {
  it('renders an accessible button labelled by `label`', () => {
    render(<JackDisconnect onDisconnect={() => {}} label="Disconnect input 2" />)
    expect(screen.getByRole('button', { name: 'Disconnect input 2' })).toBeInTheDocument()
  })

  it('calls onDisconnect and stops propagation when clicked', () => {
    const onDisconnect = vi.fn()
    const onParentClick = vi.fn()
    const { container } = render(
      <div onClick={onParentClick}>
        <JackDisconnect onDisconnect={onDisconnect} label="x" />
      </div>,
    )
    fireEvent.click(container.querySelector('button')!)
    expect(onDisconnect).toHaveBeenCalledOnce()
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('stops pointer-down propagation so it never starts a drag', () => {
    const onParentPointerDown = vi.fn()
    const { container } = render(
      <div onPointerDown={onParentPointerDown}>
        <JackDisconnect onDisconnect={() => {}} label="x" />
      </div>,
    )
    fireEvent.pointerDown(container.querySelector('button')!)
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })
})
