import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { levelToPeakDb, MediumMeter, Meter, MiniMeter } from './Meter'
import styles from './Meter.module.css'

describe('levelToPeakDb', () => {
  it('formats a level as dBFS, floored at −60', () => {
    expect(levelToPeakDb(1)).toBe('0.0')
    expect(levelToPeakDb(0.5)).toBe('−6.0')
    expect(levelToPeakDb(0.01)).toBe('−40.0')
    expect(levelToPeakDb(0.00001)).toBe('−60.0')
  })

  it('reads silence as −∞', () => {
    expect(levelToPeakDb(0)).toBe('−∞')
    expect(levelToPeakDb(-1)).toBe('−∞')
  })
})

describe('MiniMeter', () => {
  it('clips the gradient fill to the level width', () => {
    const { container } = render(<MiniMeter level={0.5} />)
    const fill = container.querySelector(`.${styles.miniFill}`) as HTMLElement
    expect(fill).toHaveClass(styles.gradient)
    expect(fill.style.clipPath).toBe('inset(0 50% 0 0)')
  })

  it('clamps level to [0, 1]', () => {
    const { container } = render(<MiniMeter level={2} />)
    const fill = container.querySelector(`.${styles.miniFill}`) as HTMLElement
    expect(fill.style.clipPath).toBe('inset(0 0% 0 0)')
  })

  it('forwards title for a tooltip', () => {
    const { container } = render(<MiniMeter level={0.5} title="−6 dB" />)
    expect(container.querySelector(`.${styles.miniWrap}`)).toHaveAttribute('title', '−6 dB')
  })

  it('gainReduction variant always shows solid red', () => {
    for (const level of [0.1, 0.5, 0.95]) {
      const { container } = render(<MiniMeter level={level} variant="gainReduction" />)
      const fill = container.querySelector(`.${styles.miniFill}`) as HTMLElement
      expect(fill).toHaveClass(styles.gainReduction)
      expect(fill).not.toHaveClass(styles.gradient)
    }
  })

  it('never renders a peak-dB label', () => {
    const { container } = render(<MiniMeter level={0.5} valueLabel="−6.0 dB" />)
    expect(container.querySelector(`.${styles.peakLabel}`)).toBeNull()
  })
})

describe('MediumMeter', () => {
  it('clips the gradient fill to the level height', () => {
    const { container } = render(<MediumMeter level={0.5} />)
    const fill = container.querySelector(`.${styles.mediumFill}`) as HTMLElement
    expect(fill).toHaveClass(styles.gradient)
    expect(fill.style.clipPath).toBe('inset(50% 0 0 0)')
  })

  it('clamps level to [0, 1]', () => {
    const { container } = render(<MediumMeter level={2} />)
    const fill = container.querySelector(`.${styles.mediumFill}`) as HTMLElement
    expect(fill.style.clipPath).toBe('inset(0% 0 0 0)')
  })

  it('gainReduction variant always shows solid red regardless of level', () => {
    for (const level of [0.1, 0.5, 0.95]) {
      const { container } = render(<MediumMeter level={level} variant="gainReduction" />)
      const fill = container.querySelector(`.${styles.mediumFill}`) as HTMLElement
      expect(fill).toHaveClass(styles.gainReduction)
      expect(fill).not.toHaveClass(styles.gradient)
    }
  })

  it('forwards title for a tooltip on the group', () => {
    const { container } = render(<MediumMeter level={0.5} title="GR: −6 dB" />)
    expect(container.querySelector(`.${styles.mediumGroup}`)).toHaveAttribute('title', 'GR: −6 dB')
  })

  it('renders the peak-dB label above the bar when given', () => {
    render(<MediumMeter level={0.5} valueLabel="−6.0 dB" />)
    expect(screen.getByText('−6.0 dB')).toBeInTheDocument()
  })

  it('renders no peak-dB label when not given', () => {
    render(<MediumMeter level={0.5} />)
    expect(screen.queryByText('−6.0 dB')).toBeNull()
  })

  it('renders the caption below the bar when given', () => {
    render(<MediumMeter level={0.5} label="IN" />)
    expect(screen.getByText('IN')).toBeInTheDocument()
  })

  it('renders no caption when not given', () => {
    const { container } = render(<MediumMeter level={0.5} />)
    expect(container.querySelector(`.${styles.meterLabel}`)).toBeNull()
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

  it('renders the peak-dB label above the segments when given', () => {
    render(<Meter level={0.5} valueLabel="−6.0 dB" />)
    expect(screen.getByText('−6.0 dB')).toBeInTheDocument()
  })

  it('renders no peak-dB label when not given', () => {
    render(<Meter level={0.5} />)
    expect(screen.queryByText('−6.0 dB')).toBeNull()
  })
})
