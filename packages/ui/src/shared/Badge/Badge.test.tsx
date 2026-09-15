import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders the neutral planned tone by default', () => {
    render(<Badge>iOS / Android</Badge>)
    const el = screen.getByText('iOS / Android')
    expect(el.className).toContain('ox-badge')
    expect(el.className).toContain('ox-badge-planned')
  })

  it('renders each status tone', () => {
    const { rerender } = render(<Badge tone="live">Live</Badge>)
    expect(screen.getByText('Live').className).toContain('ox-badge-live')

    rerender(<Badge tone="beta">Beta</Badge>)
    expect(screen.getByText('Beta').className).toContain('ox-badge-beta')

    rerender(<Badge tone="accent">Latest</Badge>)
    expect(screen.getByText('Latest').className).toContain('ox-badge-accent')
  })
})
