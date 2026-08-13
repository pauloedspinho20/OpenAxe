// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { saveMidiConfigMock } = vi.hoisted(() => ({ saveMidiConfigMock: vi.fn() }))
vi.mock('../midi/midiConfigStore', async () => {
  const actual =
    await vi.importActual<typeof import('../midi/midiConfigStore')>('../midi/midiConfigStore')
  return { ...actual, saveMidiConfig: saveMidiConfigMock }
})

const { useMidiStore } = await import('./midiStore')

function match(number: number): { type: 'pc'; channel: number; number: number } {
  return { type: 'pc', channel: 0, number }
}

describe('midiStore', () => {
  beforeEach(() => {
    saveMidiConfigMock.mockClear()
    useMidiStore.setState({
      supported: false,
      permission: 'unknown',
      error: null,
      inputs: [],
      selectedInputId: null,
      mappings: [],
      learning: null,
      lastMessage: null,
      loaded: false,
    })
  })

  it('does not persist before loadConfig() has run', () => {
    useMidiStore.getState().selectInput('in-1')
    expect(saveMidiConfigMock).not.toHaveBeenCalled()
  })

  it('startLearn sets the learning marker with the right action key', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 2 })
    expect(useMidiStore.getState().learning).toEqual({
      actionKey: 'slot:2',
      action: { kind: 'slot', slot: 2 },
    })
  })

  it('completeLearn appends a mapping and clears learning', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    useMidiStore.getState().completeLearn(match(0))

    const state = useMidiStore.getState()
    expect(state.learning).toBeNull()
    expect(state.mappings).toHaveLength(1)
    expect(state.mappings[0]?.match).toEqual(match(0))
    expect(state.mappings[0]?.action).toEqual({ kind: 'slot', slot: 0 })
  })

  it('a second completeLearn with nothing pending is a no-op', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().completeLearn(match(0))
    expect(useMidiStore.getState().mappings).toHaveLength(0)
  })

  it('re-learning the same action replaces rather than appends', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    useMidiStore.getState().completeLearn(match(0))
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    useMidiStore.getState().completeLearn(match(1))

    const mappings = useMidiStore.getState().mappings
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.match).toEqual(match(1))
  })

  it('learning a match already bound to a different action steals it', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    useMidiStore.getState().completeLearn(match(5))
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 1 })
    useMidiStore.getState().completeLearn(match(5))

    const mappings = useMidiStore.getState().mappings
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.action).toEqual({ kind: 'slot', slot: 1 })
  })

  it('cancelLearn keyed to a stale action does not cancel a newer learn', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 1 })
    useMidiStore.getState().cancelLearn('slot:0')
    expect(useMidiStore.getState().learning?.actionKey).toBe('slot:1')
  })

  it('cancelLearn with no target cancels whatever is pending', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 1 })
    useMidiStore.getState().cancelLearn()
    expect(useMidiStore.getState().learning).toBeNull()
  })

  it('clearMapping removes only the targeted entry', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    useMidiStore.getState().completeLearn(match(0))
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 1 })
    useMidiStore.getState().completeLearn(match(1))

    const id = useMidiStore.getState().mappings[0]!.id
    useMidiStore.getState().clearMapping(id)

    const mappings = useMidiStore.getState().mappings
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.action).toEqual({ kind: 'slot', slot: 1 })
  })

  it('mutations after loadConfig persist the config', () => {
    useMidiStore.setState({ loaded: true })
    useMidiStore.getState().selectInput('in-1')
    expect(saveMidiConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ selectedInputId: 'in-1' }),
    )
  })
})
