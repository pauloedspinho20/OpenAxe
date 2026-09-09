import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KIND_TO_CORE } from './RigWorkletNode'

/**
 * KIND_TO_CORE maps the web's string BlockKind onto packages/core's
 * OpenAxeBlockKind ordinals. Nothing generated it - it is hand-maintained -
 * and the core enum is renumbered whenever a kind is added or removed.
 *
 * That drift has already shipped once. #330 deleted the `ping-pong-delay`
 * kind, which shifted `kReverb` 9 -> 8, and the rig worklet's own copy of the
 * reverb ordinal kept saying 9 (which is OPENAXE_BLOCK_AMP). Its
 * `kindByJs.get(...) === REVERB_KIND` guards never matched, so every reverb
 * knob and the algorithm switch were silently dropped - no error, no log, the
 * params simply went nowhere.
 *
 * The worklet no longer keeps its own copy (RigWorkletNode hands the ordinal
 * over through processorOptions), which leaves this table as the single web
 * side source. This test reads api.h itself, so the table cannot drift from
 * the enum again without going red.
 */

// Vitest runs with apps/web as the cwd.
const API_H = resolve(process.cwd(), '../../packages/core/include/openaxe/api.h')

/** OPENAXE_BLOCK_NOISE_GATE -> 'noise-gate' */
function enumNameToKind(symbol: string): string {
  return symbol
    .replace(/^OPENAXE_BLOCK_/, '')
    .toLowerCase()
    .replace(/_/g, '-')
}

function coreBlockKindOrdinals(): Map<string, number> {
  const src = readFileSync(API_H, 'utf8')
  const body = src.match(/typedef enum OpenAxeBlockKind \{([\s\S]*?)\} OpenAxeBlockKind;/)?.[1]
  if (body === undefined) throw new Error('OpenAxeBlockKind enum not found in api.h')

  const out = new Map<string, number>()
  let next = 0
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim()
    if (line === '') continue
    const m = line.match(/^(OPENAXE_BLOCK_[A-Z0-9_]+)\s*(?:=\s*(\d+))?\s*,?$/)
    const symbol = m?.[1]
    if (symbol === undefined) continue
    // An explicit `= N` resets the running counter, same as C.
    const explicit = m?.[2]
    if (explicit !== undefined) next = Number(explicit)
    out.set(enumNameToKind(symbol), next)
    next += 1
  }
  return out
}

describe('KIND_TO_CORE vs packages/core/include/openaxe/api.h', () => {
  const core = coreBlockKindOrdinals()

  it('parses a plausible enum out of api.h', () => {
    // Guards the parser itself: if api.h's formatting changes such that this
    // finds nothing, the assertions below would all vacuously pass.
    expect(core.size).toBeGreaterThan(20)
    expect(core.get('noise-gate')).toBe(0)
  })

  it('agrees with the core enum for every kind the web knows', () => {
    const mismatches: string[] = []
    for (const [kind, ordinal] of Object.entries(KIND_TO_CORE)) {
      const expected = core.get(kind)
      if (expected === undefined) mismatches.push(`${kind}: not in api.h (web says ${ordinal})`)
      else if (expected !== ordinal) mismatches.push(`${kind}: api.h ${expected}, web ${ordinal}`)
    }
    expect(mismatches).toEqual([])
  })

  it('covers every kind the core enum declares', () => {
    const missing = [...core.keys()].filter((k) => !(k in KIND_TO_CORE))
    expect(missing).toEqual([])
  })

  it('pins reverb, the ordinal that actually drifted', () => {
    expect(KIND_TO_CORE.reverb).toBe(core.get('reverb'))
  })
})
