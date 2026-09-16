import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders a primary button by default', () => {
    render(<Button>Open web app</Button>)
    const el = screen.getByRole('button', { name: 'Open web app' })
    expect(el.className).toContain('ox-btn')
    expect(el.className).toContain('ox-btn-primary')
  })

  it('renders the ghost variant and small size', () => {
    render(
      <Button variant="ghost" size="sm">
        Download
      </Button>,
    )
    const el = screen.getByRole('button', { name: 'Download' })
    expect(el.className).toContain('ox-btn-ghost')
    expect(el.className).toContain('ox-btn-sm')
  })

  it('renders an anchor when href is given', () => {
    render(
      <Button href="https://openaxe.pages.dev" rel="noopener">
        Open web app
      </Button>,
    )
    const el = screen.getByRole('link', { name: 'Open web app' })
    expect(el).toHaveAttribute('href', 'https://openaxe.pages.dev')
    expect(el.className).toContain('ox-btn-primary')
  })

  it('forwards clicks', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Star</Button>)
    screen.getByRole('button', { name: 'Star' }).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('supports disabled buttons', () => {
    render(<Button disabled>Loading</Button>)
    expect(screen.getByRole('button', { name: 'Loading' })).toBeDisabled()
  })
})
