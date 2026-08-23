// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('gates the app behind a power-on overlay, with the routing grid mounted underneath', () => {
    render(<App />)
    expect(screen.getAllByText('OPENAXE').length).toBeGreaterThan(0)
    expect(screen.getByRole('dialog', { name: 'Power on' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'POWER ON' })).toBeInTheDocument()
    // The grid stays mounted (just visually covered) so it's ready the instant the gate clears.
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
  })
})
