import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Meter, MiniMeter } from './Meter'
import styles from './Meter.module.css'

describe('MiniMeter', () => {
  it('sets the fill width proportional to level', () => {
    const { container } = render(<MiniMeter level={0.5} />)
    const fill = container.querySelector(`.${styles.miniFill}`) as HTMLElement
    expect(fill.style.width).toBe('50%')
    expect(fill).toHaveClass(styles.statusGreen)
  })

  it('clamps level to [0, 1]', () => {
    const { container } = render(<MiniMeter level={2} />)
    const fill = container.querySelector(`.${styles.miniFill}`) as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('colors amber/red past the danger thresholds', () => {
    const { container: amber } = render(<MiniMeter level={0.8} />)
    expect(amber.querySelector(`.${styles.miniFill}`)).toHaveClass(styles.statusAmber)

    const { container: red } = render(<MiniMeter level={0.95} />)
    expect(red.querySelector(`.${styles.miniFill}`)).toHaveClass(styles.statusRed)
  })

  it('forwards title for a tooltip', () => {
    const { container } = render(<MiniMeter level={0.5} title="−6 dB" />)
    expect(container.querySelector(`.${styles.miniWrap}`)).toHaveAttribute('title', '−6 dB')
  })
})

describe('Meter', () => {
  it('renders 12 segments and lights the bottom N proportional to level', () => {
    const { container } = render(<Meter level={0.5} />)
    const segments = container.querySelectorAll(`.${styles.segment}`)
    expect(segments).toHaveLength(12)
    const lit = container.querySelectorAll(`.${styles.segment}.${styles.lit}`)
    expect(lit).toHaveLength(6) // round(0.5 * 12)
  })

  it('lights zero segments at level 0 and all 12 at level 1', () => {
    const { container: zero } = render(<Meter level={0} />)
    expect(zero.querySelectorAll(`.${styles.segment}.${styles.lit}`)).toHaveLength(0)

    const { container: full } = render(<Meter level={1} />)
    expect(full.querySelectorAll(`.${styles.segment}.${styles.lit}`)).toHaveLength(12)
  })

  it('renders a label when given', () => {
    render(<Meter label="Master" level={0.5} />)
    expect(screen.getByText('Master')).toBeInTheDocument()
  })
})
