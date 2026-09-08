// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { executeMidiActionMock, executeMidiParamActionMock } = vi.hoisted(() => ({
  executeMidiActionMock: vi.fn(),
  executeMidiParamActionMock: vi.fn(),
}))
vi.mock('./dispatch', () => ({
  executeMidiAction: executeMidiActionMock,
  executeMidiParamAction: executeMidiParamActionMock,
}))

const { useMidiStore } = await import('../state/midiStore')
const { useMidiManager } = await import('../state/midiManager')
const { requestMidiAccess, disconnectMidi, isMidiSupported } = await import('./midiAccess')

class FakeInput {
  id: string
  name: string
  manufacturer = ''
  onmidimessage: ((event: { data: Uint8Array }) => void) | null = null
  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }
}

function fireMessage(input: FakeInput, ...bytes: number[]): void {
  input.onmidimessage?.({ data: new Uint8Array(bytes) })
}

describe('midiAccess', () => {
  let fakeInputs: FakeInput[]
  let fakeAccess: { inputs: Map<string, FakeInput>; onstatechange: (() => void) | null }

  beforeEach(async () => {
    executeMidiActionMock.mockClear()
    executeMidiParamActionMock.mockClear()
    useMidiStore.setState({
      supported: false,
      permission: 'unknown',
      error: null,
      inputs: [],
      selectedInputId: null,
      mappings: [],
      learning: null,
      lastMessage: null,
      loaded: true,
    })
    useMidiManager.setState({ open: false })

    fakeInputs = [new FakeInput('in-1', 'FCB1010')]
    fakeAccess = { inputs: new Map(fakeInputs.map((i) => [i.id, i])), onstatechange: null }
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn(async () => fakeAccess),
    })

    await requestMidiAccess()
  })

  afterEach(() => {
    disconnectMidi()
    vi.unstubAllGlobals()
  })

  it('connects and enumerates the fake input', () => {
    expect(useMidiStore.getState().permission).toBe('granted')
    expect(useMidiStore.getState().inputs).toEqual([{ id: 'in-1', name: 'FCB1010' }])
  })

  it('dispatches the matching action for a bound mapping', () => {
    useMidiStore.setState({
      mappings: [
        {
          id: 'm1',
          match: { type: 'pc', channel: 0, number: 3 },
          action: { kind: 'slot', slot: 3 },
        },
      ],
    })
    fireMessage(fakeInputs[0]!, 0xc0, 3)
    expect(executeMidiActionMock).toHaveBeenCalledWith({ kind: 'slot', slot: 3 })
  })

  it('with a learn pending, the first eligible message completes it without dispatching', () => {
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    fireMessage(fakeInputs[0]!, 0xc0, 7)

    expect(useMidiStore.getState().learning).toBeNull()
    expect(useMidiStore.getState().mappings[0]?.match).toEqual({
      type: 'pc',
      channel: 0,
      number: 7,
    })
    expect(executeMidiActionMock).not.toHaveBeenCalled()
  })

  it('a clock byte while learning does not complete the learn', () => {
    useMidiStore.getState().startLearn({ kind: 'slot', slot: 0 })
    fireMessage(fakeInputs[0]!, 0xf8)
    expect(useMidiStore.getState().learning).not.toBeNull()
  })

  it('while the manager modal is open, a matching message updates lastMessage but does not dispatch', () => {
    useMidiManager.setState({ open: true })
    useMidiStore.setState({
      mappings: [
        {
          id: 'm1',
          match: { type: 'pc', channel: 0, number: 3 },
          action: { kind: 'slot', slot: 3 },
        },
      ],
    })
    fireMessage(fakeInputs[0]!, 0xc0, 3)

    expect(executeMidiActionMock).not.toHaveBeenCalled()
    expect(useMidiStore.getState().lastMessage).toEqual({
      type: 'pc',
      channel: 0,
      number: 3,
      value: 0,
    })
  })

  it('ignores a message on a non-selected input when a specific input is selected', async () => {
    fakeInputs.push(new FakeInput('in-2', 'Other'))
    fakeAccess.inputs.set('in-2', fakeInputs[1]!)
    fakeAccess.onstatechange?.()

    useMidiStore.getState().selectInput('in-1')
    useMidiStore.setState({
      mappings: [
        {
          id: 'm1',
          match: { type: 'pc', channel: 0, number: 3 },
          action: { kind: 'slot', slot: 3 },
        },
      ],
    })

    fireMessage(fakeInputs[1]!, 0xc0, 3)
    expect(executeMidiActionMock).not.toHaveBeenCalled()

    fireMessage(fakeInputs[0]!, 0xc0, 3)
    expect(executeMidiActionMock).toHaveBeenCalledWith({ kind: 'slot', slot: 3 })
  })

  it('onstatechange re-enumerates inputs', () => {
    fakeInputs.push(new FakeInput('in-2', 'Other'))
    fakeAccess.inputs.set('in-2', fakeInputs[1]!)
    fakeAccess.onstatechange?.()
    expect(useMidiStore.getState().inputs).toHaveLength(2)
  })

  it('routes every CC value (not just the trigger edge) to a mapped param', () => {
    useMidiStore.setState({
      mappings: [
        {
          id: 'm1',
          match: { type: 'cc', channel: 0, number: 20 },
          action: { kind: 'param', blockId: 'b1', paramKey: 'mix' },
        },
      ],
    })
    // A low CC value would never pass the discrete trigger-edge gate.
    fireMessage(fakeInputs[0]!, 0xb0, 20, 10)
    expect(executeMidiParamActionMock).toHaveBeenCalledWith('b1', 'mix', 10)
    expect(executeMidiActionMock).not.toHaveBeenCalled()
  })

  it('a param learn captures a low CC value without dispatching', () => {
    useMidiStore.getState().startLearn({ kind: 'param', blockId: 'b1', paramKey: 'mix' })
    fireMessage(fakeInputs[0]!, 0xb0, 20, 0)

    expect(useMidiStore.getState().learning).toBeNull()
    expect(useMidiStore.getState().mappings[0]?.match).toEqual({
      type: 'cc',
      channel: 0,
      number: 20,
    })
    expect(executeMidiParamActionMock).not.toHaveBeenCalled()
  })

  it('a param learn ignores notes and PCs (only CC can drive a knob)', () => {
    useMidiStore.getState().startLearn({ kind: 'param', blockId: 'b1', paramKey: 'mix' })
    fireMessage(fakeInputs[0]!, 0x90, 60, 100)
    fireMessage(fakeInputs[0]!, 0xc0, 3)
    expect(useMidiStore.getState().learning).not.toBeNull()
    expect(useMidiStore.getState().mappings).toHaveLength(0)
  })
})

describe('isMidiSupported / requestMidiAccess on an unsupported platform', () => {
  beforeEach(() => {
    useMidiStore.setState({ permission: 'unknown', error: null })
    vi.stubGlobal('navigator', {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reports unsupported and resolves without throwing', async () => {
    expect(isMidiSupported()).toBe(false)
    await expect(requestMidiAccess()).resolves.toBeUndefined()
    expect(useMidiStore.getState().permission).toBe('denied')
  })
})
