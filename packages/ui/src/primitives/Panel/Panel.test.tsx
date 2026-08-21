import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Panel } from './Panel'
import styles from './Panel.module.css'

describe('Panel', () => {
  it('renders children in the body', () => {
    render(
      <Panel>
        <p>content</p>
      </Panel>,
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('omits the header entirely when there is no label or corner', () => {
    const { container } = render(
      <Panel>
        <p>content</p>
      </Panel>,
    )
    expect(container.querySelector(`.${styles.header}`)).not.toBeInTheDocument()
  })

  it('renders a header with the label when given', () => {
    render(
      <Panel label="Amp">
        <p>content</p>
      </Panel>,
    )
    expect(screen.getByText('Amp')).toBeInTheDocument()
  })

  it('renders a header for corner content alone, with no label', () => {
    const { container } = render(
      <Panel corner={<span>gear</span>}>
        <p>content</p>
      </Panel>,
    )
    expect(container.querySelector(`.${styles.header}`)).toBeInTheDocument()
    expect(screen.getByText('gear')).toBeInTheDocument()
  })

  it('renders an attribution link only when both url and labelUrl are given', () => {
    const { rerender } = render(
      <Panel label="Amp" url="https://example.com/model" labelUrl="Some Model">
        <p>content</p>
      </Panel>,
    )
    const link = screen.getByRole('link', { name: 'Some Model' })
    expect(link).toHaveAttribute('href', 'https://example.com/model')

    rerender(
      <Panel label="Amp" url="https://example.com/model">
        <p>content</p>
      </Panel>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
