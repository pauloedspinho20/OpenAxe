import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Led } from './Led'
import styles from './Led.module.css'

describe('Led', () => {
  it('is off by default, with the default statusGreen color class', () => {
    const { container } = render(<Led />)
    const dot = container.querySelector(`.${styles.dot}`)
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass(styles.statusGreen)
    expect(dot).not.toHaveClass(styles.on)
  })

  it('applies the on class when lit', () => {
    const { container } = render(<Led on />)
    expect(container.querySelector(`.${styles.dot}`)).toHaveClass(styles.on)
  })

  it('applies the requested color variant class', () => {
    const { container } = render(<Led color="statusRed" />)
    expect(container.querySelector(`.${styles.dot}`)).toHaveClass(styles.statusRed)
  })

  it('renders a label when given, and omits it otherwise', () => {
    const { rerender } = render(<Led label="Clip" />)
    expect(screen.getByText('Clip')).toBeInTheDocument()
    rerender(<Led />)
    expect(screen.queryByText('Clip')).not.toBeInTheDocument()
  })
})
