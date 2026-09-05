// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ParamMidiMenu } from './ParamMidiMenu'
import { useMidiStore } from '../../../state/midiStore'

function resetMidi(over: Partial<ReturnType<typeof useMidiStore.getState>> = {}) {
  useMidiStore.setState({
    supported: true,
    permission: 'granted',
    error: null,
    inputs: [],
    selectedInputId: null,
    mappings: [],
    learning: null,
    lastMessage: null,
    loaded: true,
    ...over,
  })
}

const target = { blockId: 'b1', paramKey: 'drive', paramLabel: 'Drive' }
const anchor = { x: 50, y: 60 }

describe('ParamMidiMenu', () => {
  beforeEach(() => {
    resetMidi()
    vi.useRealTimers()
  })

  it('renders nothing without a target', () => {
    render(<ParamMidiMenu anchor={anchor} target={null} onClose={() => {}} />)
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('offers MIDI Learn for an unmapped knob', () => {
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    expect(screen.getByRole('menu', { name: 'MIDI mapping for Drive' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'MIDI Learn…' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Clear MIDI mapping' })).toBeNull()
  })

  it('Learn arms the param learn flow', () => {
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'MIDI Learn…' }))
    expect(useMidiStore.getState().learning).toEqual({
      actionKey: 'param:b1:drive',
      action: { kind: 'param', blockId: 'b1', paramKey: 'drive' },
    })
  })

  it('shows the binding and Clear for a mapped knob', () => {
    resetMidi({
      mappings: [
        {
          id: 'm1',
          match: { type: 'cc', channel: 0, number: 20 },
          action: { kind: 'param', blockId: 'b1', paramKey: 'drive' },
        },
      ],
    })
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: 'Re-learn MIDI…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Clear MIDI mapping' })).toBeInTheDocument()
  })

  it('Clear removes the mapping for this param only', () => {
    resetMidi({
      mappings: [
        {
          id: 'm1',
          match: { type: 'cc', channel: 0, number: 20 },
          action: { kind: 'param', blockId: 'b1', paramKey: 'drive' },
        },
        {
          id: 'm2',
          match: { type: 'cc', channel: 0, number: 21 },
          action: { kind: 'param', blockId: 'b1', paramKey: 'tone' },
        },
      ],
    })
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear MIDI mapping' }))
    const mappings = useMidiStore.getState().mappings
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.action).toEqual({ kind: 'param', blockId: 'b1', paramKey: 'tone' })
  })

  it('disables Learn when MIDI is not connected', () => {
    resetMidi({ supported: true, permission: 'unknown' })
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: 'MIDI Learn…' })).toBeDisabled()
  })

  it('shows Listening with cancel while learning this param', () => {
    resetMidi({
      learning: {
        actionKey: 'param:b1:drive',
        action: { kind: 'param', blockId: 'b1', paramKey: 'drive' },
      },
    })
    render(<ParamMidiMenu anchor={anchor} target={target} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Listening/ }))
    expect(useMidiStore.getState().learning).toBeNull()
  })
})
