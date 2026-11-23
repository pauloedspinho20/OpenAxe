import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Drawer } from './Drawer'

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Drawer open={false} onClose={() => {}} title="Inspector">
        <p>Body</p>
      </Drawer>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('closes on backdrop click, Close button, and Escape when overlay is true', () => {
    const onClose = vi.fn()
    render(
      <Drawer open side="right" overlay title="Inspector" onClose={onClose}>
        <p>Inspector body</p>
      </Drawer>,
    )

    fireEvent.click(screen.getByText('Inspector body'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close Inspector' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('renders inline without backdrop when overlay is false', () => {
    const onClose = vi.fn()
    render(
      <Drawer open overlay={false} showHeader={false} title="Library" onClose={onClose}>
        <p>Library body</p>
      </Drawer>,
    )
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Library' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('suppresses Escape dismissal when active is false', () => {
    const onClose = vi.fn()
    render(
      <Drawer open overlay active={false} title="Inspector" onClose={onClose}>
        <p>Inspector body</p>
      </Drawer>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
