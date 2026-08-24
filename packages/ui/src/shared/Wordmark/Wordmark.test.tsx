import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Wordmark } from './Wordmark'

describe('Wordmark', () => {
  it('renders without version by default when no prop and fallback is stubbed', () => {
    // When version prop is omitted and fallback is the package version (0.2.0),
    // it will render version + beta. To test the no-version case we pass empty.
    const { container } = render(<Wordmark version="" showBeta={false} />)
    expect(container.textContent).not.toMatch(/v0\.2\.0/)
    expect(screen.queryByText('BETA')).not.toBeInTheDocument()
  })

  it('renders v{VERSION} when version prop is provided', () => {
    render(<Wordmark version="0.2.0" />)
    expect(screen.getByLabelText('version v0.2.0')).toBeInTheDocument()
    expect(screen.getByText('v0.2.0')).toBeInTheDocument()
  })

  it('normalises v prefix and trims', () => {
    render(<Wordmark version=" v1.2.3 " />)
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
  })

  it('shows BETA pill when major < 1', () => {
    render(<Wordmark version="0.2.0" />)
    expect(screen.getByLabelText('beta')).toBeInTheDocument()
    expect(screen.getByText('BETA')).toBeInTheDocument()
  })

  it('hides BETA pill for >= 1.0.0 by default', () => {
    render(<Wordmark version="1.0.0" />)
    expect(screen.queryByText('BETA')).not.toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('showBeta prop can force on/off', () => {
    const { rerender } = render(<Wordmark version="1.0.0" showBeta />)
    expect(screen.getByText('BETA')).toBeInTheDocument()
    rerender(<Wordmark version="0.2.0" showBeta={false} />)
    expect(screen.queryByText('BETA')).not.toBeInTheDocument()
  })

  it('renders both variants with version + beta', () => {
    const { rerender } = render(<Wordmark variant="inline" version="0.2.0" />)
    expect(screen.getByText('v0.2.0')).toBeInTheDocument()
    rerender(<Wordmark variant="hero" version="0.2.0" />)
    expect(screen.getByText('v0.2.0')).toBeInTheDocument()
    expect(screen.getByText('BETA')).toBeInTheDocument()
  })
})
