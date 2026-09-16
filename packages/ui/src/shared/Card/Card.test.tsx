import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('renders children in the system card surface', () => {
    const { container } = render(
      <Card>
        <p>content</p>
      </Card>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(container.querySelector('.ox-card')).toBeInTheDocument()
  })

  it('renders no heading without a title', () => {
    const { container } = render(
      <Card>
        <p>content</p>
      </Card>,
    )
    expect(container.querySelector('.ox-card-title')).not.toBeInTheDocument()
  })

  it('renders the title as a card heading', () => {
    render(<Card title="AMP — NAM captures">content</Card>)
    expect(screen.getByRole('heading', { name: 'AMP — NAM captures' })).toHaveClass('ox-card-title')
  })
})
