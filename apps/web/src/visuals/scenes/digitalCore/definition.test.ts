import { describe, expect, it } from 'vitest'

import { FEATURE_IDS } from '../../audio/features'
import { isModulatable } from '../../types'
import { digitalCore } from './definition'
import { buildCore, buildHaze, buildLines, buildParticles, buildRoom, mulberry32 } from './generate'
import * as THREE from 'three/webgpu'

describe('digitalCore definition', () => {
  it('has unique param keys and in-range number defaults', () => {
    const keys = digitalCore.params.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of digitalCore.params) {
      if (p.type !== 'number') continue
      expect(p.default, p.key).toBeGreaterThanOrEqual(p.min)
      expect(p.default, p.key).toBeLessThanOrEqual(p.max)
      expect(p.step, p.key).toBeGreaterThan(0)
    }
  })

  it('only routes known features to modulatable params', () => {
    const targets = new Set(digitalCore.params.filter(isModulatable).map((p) => p.key))
    const ids = digitalCore.modulations.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of digitalCore.modulations) {
      expect(targets.has(m.param), `${m.id} -> ${m.param}`).toBe(true)
      expect(FEATURE_IDS).toContain(m.source)
      expect(Math.abs(m.amount)).toBeLessThanOrEqual(1)
    }
  })

  it('credits the original author', () => {
    expect(digitalCore.credit?.author).toBe('Sabo Sugi')
  })
})

describe('digitalCore generation', () => {
  const params = {
    seed: 11,
    coreDensity: 1,
    roomDepth: 1,
    blockDetail: 1,
    lineCount: 220,
    particleCount: 2600,
  }

  it('is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('builds the expected instance counts and 12 core edges', () => {
    const base = new THREE.BoxGeometry(1, 1, 1)
    const room = buildRoom(params, base)
    const core = buildCore(params, base)
    expect(room.instanceCount).toBeGreaterThan(50)
    expect(core.edges).toHaveLength(12)
    expect(core.dark.instanceCount).toBeGreaterThan(1)
    expect(core.glow.instanceCount).toBeGreaterThan(core.dark.instanceCount)
    expect(buildLines(params).instanceCount).toBe(220)
    expect(buildParticles(params).instanceCount).toBe(2600)
    expect(buildHaze(params).instanceCount).toBe(11)
    // moving blocks carry an edge axis in aMotion.x, static ones -1
    const motion = core.dark.getAttribute('aMotion').array as Float32Array
    expect(motion[0]).toBe(-1)
    expect(Array.from(motion).some((v, i) => i % 4 === 0 && v >= 0)).toBe(true)
  })
})
