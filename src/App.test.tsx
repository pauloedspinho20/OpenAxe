import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the wordmark and the routing grid before power-on', () => {
    render(<App />)
    expect(screen.getByText('NAM WEB STUDIO')).toBeInTheDocument()
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Power on' })).toBeInTheDocument()
  })
})
