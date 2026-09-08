// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  classifyInputRisk,
  isMicRiskAcknowledged,
  resolveSelectedInputLabel,
} from './detectRiskyInput'
import type { IODevice } from '../state/ioStore'

function dev(id: string, label: string, groupId = ''): IODevice {
  return { deviceId: id, label, groupId }
}

describe('classifyInputRisk', () => {
  it('flags MacBook / built-in / FaceTime inputs as risky', () => {
    const outs = [dev('o', 'MacBook Pro Speakers', 'g')]
    expect(classifyInputRisk('i', [dev('i', 'MacBook Pro Microphone', 'g')], outs)).toBe('risky')
    expect(classifyInputRisk('i', [dev('i', 'Built-in Microphone', 'g')], outs)).toBe('risky')
    expect(classifyInputRisk('i', [dev('i', 'Built-in Audio Analog Stereo', 'g')], outs)).toBe(
      'risky',
    )
    expect(classifyInputRisk('i', [dev('i', 'FaceTime HD Camera', 'g')], outs)).toBe('risky')
  })

  it('flags Windows array-mic and front-mic names as risky', () => {
    const outs = [dev('o', 'Speakers (Realtek Audio)', 'g')]
    expect(
      classifyInputRisk('i', [dev('i', 'Microphone Array (Realtek(R) Audio)', 'g')], outs),
    ).toBe('risky')
    expect(classifyInputRisk('i', [dev('i', 'FrontMic', 'g')], outs)).toBe('risky')
  })

  it('leaves real interfaces alone, even duplex ones sharing a groupId', () => {
    // A Scarlett groups its input with its output — groupId alone must not nag.
    const inputs = [dev('i', 'Scarlett 2i4 USB: Audio (hw:USB,0)', 'scarlett')]
    const outs = [dev('o', 'Scarlett 2i4 USB: Audio (hw:USB,0)', 'scarlett')]
    expect(classifyInputRisk('i', inputs, outs)).toBe('safe')
    expect(
      classifyInputRisk('u', [dev('u', 'UMC204HD 192k', 'u1')], [dev('o', 'UMC204HD 192k', 'u1')]),
    ).toBe('safe')
    expect(classifyInputRisk('d', [dev('d', 'DI Box — Radial J48', 'x')], [])).toBe('safe')
  })

  it('flags a generic mic grouped with speakers as risky (headset combo)', () => {
    const inputs = [dev('i', 'USB Headset Microphone', 'hs')]
    const outs = [dev('o', 'USB Headset Speakers', 'hs')]
    expect(classifyInputRisk('i', inputs, outs)).toBe('risky')
  })

  it('treats empty labels (pre-permission) as unknown, not safe', () => {
    expect(classifyInputRisk('i', [dev('i', '', 'g')], [dev('o', '', 'g')])).toBe('unknown')
    expect(classifyInputRisk('mic', [dev('mic', 'Microphone')], [])).toBe('unknown')
  })

  it('treats Default as unknown when an internal mic is in the list or labels are missing', () => {
    expect(
      classifyInputRisk('', [dev('a', 'MacBook Pro Microphone'), dev('b', 'Scarlett 2i4 USB')], []),
    ).toBe('unknown')
    expect(classifyInputRisk('', [dev('a', ''), dev('b', '')], [])).toBe('unknown')
  })

  it('treats Default as safe when everything is labelled and nothing is internal', () => {
    expect(classifyInputRisk('', [dev('a', 'Scarlett 2i4 USB')], [])).toBe('safe')
  })

  it('treats Default with no enumerated devices as safe (no evidence, do not block)', () => {
    expect(classifyInputRisk('', [], [])).toBe('safe')
  })

  it('treats a stale (unplugged) device id as unknown', () => {
    expect(classifyInputRisk('gone', [dev('a', 'Scarlett 2i4 USB')], [])).toBe('unknown')
  })
})

describe('resolveSelectedInputLabel / isMicRiskAcknowledged', () => {
  it('resolves labels and matches acks per device', () => {
    const inputs = [dev('a', 'Built-in Microphone')]
    expect(resolveSelectedInputLabel('a', inputs)).toBe('Built-in Microphone')
    expect(resolveSelectedInputLabel('', inputs)).toBe('')
    expect(isMicRiskAcknowledged('a', 'Built-in Microphone', 'a', 'Built-in Microphone')).toBe(true)
  })

  it('re-arms when the device or its resolved label changes', () => {
    // Switching input…
    expect(isMicRiskAcknowledged('b', 'Scarlett', 'a', 'Built-in Microphone')).toBe(false)
    // …or labels resolving after permission (pre-permission ack was for '').
    expect(isMicRiskAcknowledged('a', 'Built-in Microphone', 'a', '')).toBe(false)
    expect(isMicRiskAcknowledged('a', 'Built-in Microphone', null, null)).toBe(false)
  })
})
