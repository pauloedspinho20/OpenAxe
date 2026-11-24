import { useEffect } from 'react'

import { onMidiCc } from '../midi/midiAccess'
import { messageMatches } from '../midi/message'
import type { MidiMessage } from '../midi/types'
import { findScene } from './registry'
import type { ParamValue, SceneParam } from './types'
import { useVisualsStore } from './visualsStore'

/** Maps a 0..127 CC value onto a param, or null when the param takes no value. */
export function ccToValue(param: SceneParam, cc: number): ParamValue | null {
  const t = Math.min(1, Math.max(0, cc / 127))
  switch (param.type) {
    case 'number': {
      const raw = param.min + t * (param.max - param.min)
      const stepped = Math.round((raw - param.min) / param.step) * param.step + param.min
      return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(6))))
    }
    case 'boolean':
      return cc >= 64
    case 'select': {
      const i = Math.min(param.options.length - 1, Math.floor(t * param.options.length))
      return param.options[i]?.value ?? param.default
    }
    default:
      return null
  }
}

/**
 * CC learn + CC -> param bindings for the VISUALS view. Bindings belong to a
 * scene and only move it while it is the open scene; learn always consumes
 * the CC so a knob being learned does not also move a rig param.
 */
export function useVisualsMidi(onAction: (key: string) => void) {
  useEffect(() => {
    return onMidiCc((message: MidiMessage) => {
      const state = useVisualsStore.getState()
      if (state.learning) {
        state.completeLearn({
          type: message.type,
          channel: message.channel,
          number: message.number,
        })
        return true
      }
      const def = findScene(state.sceneId)
      for (const binding of state.midi) {
        if (binding.sceneId !== def.id || !messageMatches(message, binding.match)) continue
        const param = def.params.find((p) => p.key === binding.param)
        if (!param) continue
        if (param.type === 'action') {
          if (message.value >= 64) onAction(param.key)
          continue
        }
        const value = ccToValue(param, message.value)
        if (value !== null) state.setParam(def.id, param.key, value)
      }
      return false
    })
  }, [onAction])
}
