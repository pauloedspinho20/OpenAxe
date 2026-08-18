import { describe, expect, it } from 'vitest'
import { describePowerOnError } from './useAudioEngine'

// The rest of useAudioEngine relies on real AudioContext/getUserMedia, which
// jsdom doesn't implement - describePowerOnError is the one pure, DOM-free
// piece (issue #49: give a WASM/network load failure a message worth
// showing, instead of a raw `TypeError: Failed to fetch`).
describe('describePowerOnError', () => {
  it('recognizes a WASM fetch failure', () => {
    const message = describePowerOnError(new TypeError('Failed to fetch'))
    expect(message).toMatch(/check your connection/i)
  })

  it('recognizes a permission/NotAllowedError failure', () => {
    const message = describePowerOnError(new Error('NotAllowedError: permission denied'))
    expect(message).toMatch(/blocked by the browser/i)
  })

  it('falls back to the original message for anything else', () => {
    expect(describePowerOnError(new Error('graph rig create failed'))).toBe(
      'graph rig create failed',
    )
  })

  it('stringifies a non-Error throw', () => {
    expect(describePowerOnError('boom')).toBe('boom')
  })
})
