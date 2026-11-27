import { describe, expect, it } from 'vitest'

import { QUALITY_PRESETS, proceduralFire } from './definition'
import {
  EdgeTrigger,
  blackbodyLUT,
  buildCampfire,
  halton,
  lookAt,
  orbit,
  packLogs,
  packStones,
} from './math'

describe('proceduralFire definition', () => {
  it('rebuilds only for quality tier and campfire seed', () => {
    const rebuild = proceduralFire.params.filter((p) => p.rebuild).map((p) => p.key)
    expect(rebuild.sort()).toEqual(['quality', 'seed'])
  })

  it('offers every quality preset in order', () => {
    const quality = proceduralFire.params.find((p) => p.key === 'quality')
    const values = quality?.type === 'select' ? quality.options.map((o) => o.value) : []
    expect(values).toEqual(Object.keys(QUALITY_PRESETS))
  })

  it('configures valid occupancy-aligned dimensions and solver settings on all quality presets', () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      for (const dim of preset.res) {
        expect(dim).toBeGreaterThan(0)
        expect(dim % 4).toBe(0)
      }
      expect(preset.vcycles).toBeGreaterThan(0)
      expect(preset.mgSmooth).toBeGreaterThan(0)
      expect(preset.coarseCap).toBeGreaterThan(0)
      expect(preset.simDt).toBeGreaterThan(0)
      expect(preset.sparks).toBeGreaterThan(0)
      expect(preset.shadowSteps).toBeGreaterThan(0)
      expect(preset.shadowMode).toBeGreaterThanOrEqual(1)
      expect(preset.shadowMode).toBeLessThanOrEqual(3)
    }
  })
})

describe('proceduralFire CPU helpers', () => {
  it('builds a valid blackbody + soot lookup table', () => {
    const lut = blackbodyLUT({ n: 32, Tmin: 400, Tmax: 3000, Twb: 5000 })
    expect(lut.data.length).toBe(32 * 4 * 2)
    for (const v of lut.data) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
    const lowLum = lut.data[3]!
    const highLum = lut.data[31 * 4 + 3]!
    expect(highLum).toBeGreaterThan(lowLum)
  })

  it('builds campfire logs and stones within shader bounds', () => {
    const { logs, stones } = buildCampfire(7)
    expect(logs.length).toBe(8)
    expect(stones.length).toBe(14)

    for (const st of stones) {
      const r = Math.hypot(st.c[0], st.c[2])
      const ext = Math.max(st.s[0], st.s[2])
      expect(r - ext).toBeGreaterThanOrEqual(0.4)
      expect(r + ext).toBeLessThanOrEqual(0.93)
      expect(st.c[1] + st.s[1]).toBeLessThanOrEqual(0.19)
    }

    const packedLogs = packLogs(logs)
    const packedStones = packStones(stones)
    expect(packedLogs.length).toBe(16 * 8)
    expect(packedStones.length).toBe(16 * 8)
    for (const v of packedLogs) expect(Number.isFinite(v)).toBe(true)
    for (const v of packedStones) expect(Number.isFinite(v)).toBe(true)
  })

  it('produces an orthonormal camera basis from orbit and lookAt', () => {
    const cam = orbit({ yaw: 0.35, pitch: 0.15, dist: 2.35, target: [0, 0.45, 0], fov: 40 })
    const len = (v: readonly [number, number, number]) => Math.hypot(v[0], v[1], v[2])
    const dot = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    expect(len(cam.fwd)).toBeCloseTo(1, 5)
    expect(len(cam.right)).toBeCloseTo(1, 5)
    expect(len(cam.up)).toBeCloseTo(1, 5)
    expect(dot(cam.fwd, cam.right)).toBeCloseTo(0, 5)
    expect(dot(cam.fwd, cam.up)).toBeCloseTo(0, 5)
    expect(dot(cam.right, cam.up)).toBeCloseTo(0, 5)
    expect(cam.fovY).toBeCloseTo((40 * Math.PI) / 180, 5)

    const rolled = lookAt([0, 0.5, 2], [0, 0.4, 0], 45, 0.25)
    expect(len(rolled.right)).toBeCloseTo(1, 5)
    expect(len(rolled.up)).toBeCloseTo(1, 5)
  })

  it('computes Halton sequence in [0, 1) and triggers only on rising edges', () => {
    for (let i = 1; i <= 16; i++) {
      expect(halton(i, 2)).toBeGreaterThanOrEqual(0)
      expect(halton(i, 2)).toBeLessThan(1)
      expect(halton(i, 3)).toBeGreaterThanOrEqual(0)
      expect(halton(i, 3)).toBeLessThan(1)
    }

    const trig = new EdgeTrigger(0.05)
    expect(trig.step(0)).toBe(0)
    expect(trig.step(0.03)).toBe(0)
    expect(trig.step(0.5)).toBe(0.5)
    expect(trig.step(0.5)).toBe(0)
    expect(trig.step(0.2)).toBe(0)
    expect(trig.step(0.8)).toBe(0.8)
  })
})
