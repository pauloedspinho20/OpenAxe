import { beforeEach, describe, expect, it } from 'vitest'

import { distilledCube } from './scenes/distilledCube/definition'
import { ccToValue } from './useVisualsMidi'
import { presetIsDirty, resolveModulations, resolveParams, useVisualsStore } from './visualsStore'
import type { SceneParam } from './types'

describe('resolveParams', () => {
  it('starts from definition defaults', () => {
    const p = resolveParams(distilledCube, undefined)
    expect(p.fov).toBe(34)
    expect(p.glassColor).toBe('#65f3f3')
    expect('resetRotation' in p).toBe(false)
  })

  it('applies overrides, clamps numbers and drops wrongly typed or unknown values', () => {
    const p = resolveParams(distilledCube, {
      params: { fov: 500, exposure: 'loud', glassColor: '#ff0000', gone: 1 },
      modulations: null,
    })
    expect(p.fov).toBe(70)
    expect(p.exposure).toBe(1.9)
    expect(p.glassColor).toBe('#ff0000')
    expect('gone' in p).toBe(false)
  })
})

describe('resolveModulations', () => {
  it('uses the scene defaults until customised and drops routes to removed params', () => {
    expect(resolveModulations(distilledCube, undefined)).toHaveLength(
      distilledCube.modulations.length,
    )
    const custom = resolveModulations(distilledCube, {
      params: {},
      modulations: [
        { ...distilledCube.modulations[0]! },
        { ...distilledCube.modulations[0]!, id: 'x', param: 'removedParam' },
      ],
    })
    expect(custom).toHaveLength(1)
  })
})

describe('MIDI learn', () => {
  beforeEach(() => useVisualsStore.setState({ midi: [], learning: null }))

  it('binds the learned CC and replaces an older binding of the same CC or param', () => {
    const s = useVisualsStore.getState()
    s.startLearn('distilled-cube', 'fov')
    s.completeLearn({ type: 'cc', channel: 0, number: 21 })
    s.startLearn('distilled-cube', 'exposure')
    s.completeLearn({ type: 'cc', channel: 0, number: 21 })
    const { midi, learning } = useVisualsStore.getState()
    expect(learning).toBeNull()
    expect(midi).toEqual([
      {
        match: { type: 'cc', channel: 0, number: 21 },
        sceneId: 'distilled-cube',
        param: 'exposure',
      },
    ])
  })
})

describe('ccToValue', () => {
  const num: SceneParam = {
    key: 'k',
    label: 'K',
    group: 'G',
    type: 'number',
    min: 1,
    max: 3,
    step: 0.5,
    default: 2,
  }
  it('maps CC range onto stepped param range', () => {
    expect(ccToValue(num, 0)).toBe(1)
    expect(ccToValue(num, 127)).toBe(3)
    expect(ccToValue(num, 64)).toBe(2)
  })
  it('maps booleans and selects', () => {
    expect(
      ccToValue({ key: 'b', label: 'B', group: 'G', type: 'boolean', default: false }, 100),
    ).toBe(true)
    const sel: SceneParam = {
      key: 's',
      label: 'S',
      group: 'G',
      type: 'select',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    }
    expect(ccToValue(sel, 0)).toBe('a')
    expect(ccToValue(sel, 127)).toBe('b')
  })
})

describe('presets', () => {
  const SCENE = 'distilled-cube'
  beforeEach(() => useVisualsStore.setState({ scenes: {}, presets: {}, activePreset: {} }))

  it('saves a snapshot, tracks dirtiness, updates and reloads it', () => {
    const s = useVisualsStore.getState()
    s.setParam(SCENE, 'fov', 50)
    const id = s.savePreset(SCENE, '  Wide  ')
    let st = useVisualsStore.getState()
    const preset = st.presets[SCENE]![0]!
    expect(preset.name).toBe('Wide')
    expect(preset.params).toEqual({ fov: 50 })
    expect(st.activePreset[SCENE]).toBe(id)
    expect(presetIsDirty(preset, st.scenes[SCENE])).toBe(false)

    // Editing after saving makes it dirty, and the snapshot is not aliased.
    s.setParam(SCENE, 'fov', 20)
    st = useVisualsStore.getState()
    expect(st.presets[SCENE]![0]!.params.fov).toBe(50)
    expect(presetIsDirty(st.presets[SCENE]![0]!, st.scenes[SCENE])).toBe(true)

    // Loading restores the snapshot.
    s.loadPreset(SCENE, id)
    expect(useVisualsStore.getState().scenes[SCENE]!.params.fov).toBe(50)

    // Update overwrites with the current state.
    s.setParam(SCENE, 'exposure', 3)
    s.updatePreset(SCENE, id)
    expect(useVisualsStore.getState().presets[SCENE]![0]!.params).toEqual({ fov: 50, exposure: 3 })
  })

  it('stores customised routes and restores scene defaults for presets without them', () => {
    const s = useVisualsStore.getState()
    const plain = s.savePreset(SCENE, 'Defaults')
    s.setModulations(SCENE, [{ ...distilledCube.modulations[0]!, amount: -0.5 }])
    const custom = s.savePreset(SCENE, 'Custom routes')
    s.loadPreset(SCENE, plain)
    expect(useVisualsStore.getState().scenes[SCENE]!.modulations).toBeNull()
    s.loadPreset(SCENE, custom)
    expect(useVisualsStore.getState().scenes[SCENE]!.modulations![0]!.amount).toBe(-0.5)
  })

  it('renames and deletes, clearing the active preset when it is deleted', () => {
    const s = useVisualsStore.getState()
    const id = s.savePreset(SCENE, 'A')
    s.renamePreset(SCENE, id, 'B')
    s.renamePreset(SCENE, id, '   ')
    expect(useVisualsStore.getState().presets[SCENE]![0]!.name).toBe('B')
    s.deletePreset(SCENE, id)
    const st = useVisualsStore.getState()
    expect(st.presets[SCENE]).toEqual([])
    expect(st.activePreset[SCENE]).toBeNull()
  })
})
