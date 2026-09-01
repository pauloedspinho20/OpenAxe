#!/usr/bin/env node
// Generates C++ param-table fragments and a JS symbol->index map module from
// packages/core/param_schema.json (issue #51's single source of truth for
// effect-param names/symbols/ranges), plus the plugin automation-slot layout
// (issue #121 - see packages/vst3/README.md's design note). Run with --check
// to verify the checked-in generated files are up to date instead of
// overwriting them (used in CI to fail the build on drift - see
// .github/workflows/ci.yml).
//
// Usage:
//   node scripts/gen-param-schema.mjs                    # regenerate everything in place
//   node scripts/gen-param-schema.mjs --check            # exit 1 if anything is stale, no writes
//   node scripts/gen-param-schema.mjs --target=base      # only the original three outputs
//   node scripts/gen-param-schema.mjs --target=automation-map --check
//   node scripts/gen-param-schema.mjs --target=effects       # effects.config.json outputs
//   ...--target accepts a comma list; omitting it selects every target.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA_PATH = join(ROOT, 'packages/core/param_schema.json')
const CPP_OUT_DIR = join(ROOT, 'packages/core/src/dsp/generated')
const JS_OUT_PATH = join(ROOT, 'apps/web/public/wasm-core/generatedParams.js')
const TS_RANGES_OUT_PATH = join(ROOT, 'apps/web/src/effects/generatedParamRanges.ts')
const AUTOMATION_MAP_OUT_PATH = join(ROOT, 'packages/vst3/generated/automation_param_map.h')
const BLOCKS_CONFIG_PATH = join(ROOT, 'packages/core/effects.config.json')
const BLOCKS_HEADER_OUT_PATH = join(ROOT, 'packages/core/include/openaxe/generated/enabled_blocks.h')
const BLOCKS_CMAKE_OUT_PATH = join(ROOT, 'packages/core/generated/block_sources.cmake')
const BLOCKS_TS_OUT_PATH = join(ROOT, 'apps/web/src/effects/generatedBlockConfig.ts')

// Target selection: `--target=a,b` narrows the run to those outputs; no flag
// means all of them (what CI's plain `--check` runs, so a new generated file
// is drift-covered without touching ci.yml).
const KNOWN_TARGETS = ['base', 'automation-map', 'effects']
const targetArg = process.argv.find((a) => a.startsWith('--target='))
let selectedTargets = [...KNOWN_TARGETS]
if (targetArg) {
  selectedTargets = targetArg
    .slice('--target='.length)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const t of selectedTargets) {
    if (!KNOWN_TARGETS.includes(t)) {
      console.error(`Unknown --target '${t}' (known: ${KNOWN_TARGETS.join(', ')})`)
      process.exit(1)
    }
  }
}

const CHECK_ONLY = process.argv.includes('--check')

const GENERATED_HEADER_CPP = (source) => `// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from ${source}.
// Included into the enclosing kParamInfo array literal - see that file for
// the struct type and any hand-written params this fragment doesn't cover.
`

const GENERATED_HEADER_JS = (source) => `// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from ${source}.
// Per-effect (and per-model-variant) maps of param symbol -> core param
// index, matching packages/core's GetParamInfo() order exactly. Import these
// instead of hardcoding index constants so a core param-table reorder can't
// silently desync a worklet (issue #51).
`

const GENERATED_HEADER_TS = (source) => `// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from ${source}.
// Per-kind maps of param symbol -> {min, max}, the core's own range for that
// param. apps/web/src/effects/paramSchema.ts sources every symbol-mapped
// knob's min/max from here instead of hand-duplicating them, so they can't
// silently drift from what the DSP actually accepts (issue #72). Everything
// else about a field (step, defaultValue, formatValue, group, visible,
// select options) is a UI presentation choice with no core-side equivalent
// and stays hand-written in paramSchema.ts. Not every symbol here is
// necessarily used by paramSchema.ts - e.g. amp's input_level/output_level
// mean the loaded capture's dBu calibration here, not the UI's differently-
// scaled I/O trim knobs of the same name - paramSchema.ts picks which
// symbols per kind it actually consumes.
`

function cppFloat(n) {
  // C++ float literals: always show a decimal point (10 -> "10.0f").
  const s = Number.isInteger(n) ? `${n}.0` : String(n)
  return `${s}f`
}

function cppRow(param) {
  const { label, symbol, min, max, unit } = param
  return `    {"${label}", "${symbol}", ${cppFloat(min)}, ${cppFloat(max)}, "${unit}"},`
}

function cppFragmentName(cppFile, variantKey) {
  const base = cppFile.replace(/\.cpp$/, '')
  return variantKey ? `${base}_${variantKey.replace(/-/g, '_')}_params.inc` : `${base}_params.inc`
}

// Parallel to cppFragmentName, but for the generated per-param smoothing
// tables that back issue #122's sample-accurate ramping. Same fragment naming
// so engine.cpp can #include both `<base>_params.inc` and `<base>_smoothing.inc`.
function cppSmoothingFragmentName(cppFile, variantKey) {
  const base = cppFile.replace(/\.cpp$/, '')
  return variantKey
    ? `${base}_${variantKey.replace(/-/g, '_')}_smoothing.inc`
    : `${base}_smoothing.inc`
}

const SMOOTHING_MODE_ENUM = {
  none: 'openaxe::dsp::SmoothingMode::kNone',
  linear: 'openaxe::dsp::SmoothingMode::kLinear',
  exponential: 'openaxe::dsp::SmoothingMode::kExponential',
}

// Default smoothing policy when a param omits the field entirely: snap (no
// ramp). One-pole exponential and linear slew both need a time constant and a
// range (the latter only for the linear slew rate).
function smoothingOf(param) {
  const s = param.smoothing
  if (!s || !s.mode || s.mode === 'none') {
    return { mode: 'none', timeConstant: 0, min: param.min ?? 0, max: param.max ?? 1 }
  }
  return {
    mode: s.mode,
    timeConstant: s.timeConstant ?? 0,
    min: param.min ?? 0,
    max: param.max ?? 1,
  }
}

function cppSmoothingRow(param) {
  const s = smoothingOf(param)
  const mode = SMOOTHING_MODE_ENUM[s.mode] ?? SMOOTHING_MODE_ENUM.none
  return `    {${mode}, ${cppFloat(s.timeConstant)}, ${cppFloat(s.min)}, ${cppFloat(s.max)}},`
}

// A ramp mode the engine can't run (or a typo'd one, which would otherwise
// silently degrade to `none`), or an exponential/linear row without a positive
// time constant (which would stall the ramp and poison SubBlocksForSmoothing's
// sub-block math) must fail generation rather than ship as a broken table.
function validateSmoothing(schema) {
  for (const [kind, def] of Object.entries(schema.effects)) {
    for (const param of def.params ?? []) {
      const s = param.smoothing
      if (!s || !s.mode) continue
      if (!(s.mode in SMOOTHING_MODE_ENUM)) {
        throw new Error(
          `${kind}.${param.id ?? param.symbol}: unknown smoothing.mode '${s.mode}' (expected none|linear|exponential)`,
        )
      }
      if (
        (s.mode === 'linear' || s.mode === 'exponential') &&
        !(typeof s.timeConstant === 'number' && s.timeConstant > 0)
      ) {
        throw new Error(
          `${kind}.${param.id ?? param.symbol}: smoothing.mode '${s.mode}' requires a positive numeric timeConstant`,
        )
      }
    }
  }
}

function jsIdent(kind) {
  return kind
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
}

function rangesOf(params) {
  return Object.fromEntries(params.map((p) => [p.symbol, { min: p.min, max: p.max }]))
}

function buildTargets(schema) {
  // Each target is one generated C++ .inc fragment: {fragmentName, params}.
  const cppTargets = []
  // One JS symbol->index map per effect kind, keyed by variant name where the
  // effect has model variants (reverb), or a flat map otherwise.
  const jsMaps = {}
  // One symbol->{min,max} map per effect kind, same variant-keying as jsMaps.
  const ranges = {}

  for (const [kind, def] of Object.entries(schema.effects)) {
    if (def.variants) {
      const perVariant = {}
      const perVariantRanges = {}
      for (const [variantKey, variant] of Object.entries(def.variants)) {
        if (variant.cppFile) {
          cppTargets.push({
            fragmentName: cppFragmentName(variant.cppFile, null),
            params: variant.params,
          })
        }
        perVariant[variantKey] = Object.fromEntries(variant.params.map((p, i) => [p.symbol, i]))
        perVariantRanges[variantKey] = rangesOf(variant.params)
      }
      jsMaps[kind] = perVariant
      ranges[kind] = perVariantRanges
    } else {
      if (def.cppFile) {
        cppTargets.push({ fragmentName: cppFragmentName(def.cppFile, null), params: def.params })
      }
      jsMaps[kind] = Object.fromEntries(def.params.map((p, i) => [p.symbol, i]))
      ranges[kind] = rangesOf(def.params)
    }
  }
  return { cppTargets, jsMaps, ranges }
}

function renderCppFragment(target) {
  return (
    GENERATED_HEADER_CPP('packages/core/param_schema.json') +
    target.params.map(cppRow).join('\n') +
    '\n'
  )
}

const GENERATED_HEADER_CPP_SMOOTHING = (source) => `// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from ${source}.
// One ParamSmoothing row per param, in the same order as the matching
// <base>_params.inc fragment, so engine.cpp can #include both into parallel
// arrays. See openaxe/dsp/smoothing.h for the struct and the ramp math.
`

function renderCppSmoothingFragment(target) {
  return (
    GENERATED_HEADER_CPP_SMOOTHING('packages/core/param_schema.json') +
    target.params.map(cppSmoothingRow).join('\n') +
    '\n'
  )
}

function renderJsModule(jsMaps) {
  const lines = [GENERATED_HEADER_JS('packages/core/param_schema.json')]
  for (const [kind, value] of Object.entries(jsMaps)) {
    const constName = jsIdent(kind).toUpperCase() + '_PARAMS'
    const isVariantMap =
      !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'object')
    if (isVariantMap) {
      lines.push(`export const ${constName} = Object.freeze({`)
      for (const [variantKey, indexMap] of Object.entries(value)) {
        lines.push(`  '${variantKey}': Object.freeze(${JSON.stringify(indexMap)}),`)
      }
      lines.push('})')
    } else {
      lines.push(`export const ${constName} = Object.freeze(${JSON.stringify(value)})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function renderTsRangesModule(ranges) {
  const lines = [GENERATED_HEADER_TS('packages/core/param_schema.json')]
  lines.push('export const PARAM_RANGES = Object.freeze({')
  for (const [kind, value] of Object.entries(ranges)) {
    // Both flat and variant-shaped kinds have object-typed values one level
    // in ({min,max} vs. {symbol: {min,max}, ...}) - unlike renderJsModule's
    // index maps (numbers vs. objects), so distinguish by whether a sample
    // value itself looks like a leaf range (has a "min" key) or another map.
    const sample = Object.values(value)[0]
    const isVariantMap = sample !== undefined && !('min' in sample)
    if (isVariantMap) {
      lines.push(`  '${kind}': Object.freeze({`)
      for (const [variantKey, rangeMap] of Object.entries(value)) {
        lines.push(`    '${variantKey}': Object.freeze(${JSON.stringify(rangeMap)}),`)
      }
      lines.push('  }),')
    } else {
      lines.push(`  '${kind}': Object.freeze(${JSON.stringify(value)}),`)
    }
  }
  lines.push('})')
  return lines.join('\n') + '\n'
}

// ── Plugin automation-slot layout (issue #121) ────────────────────────────
//
// The host-facing parameter table is fixed at plugin construction and its ids
// persist across sessions, so every number that shapes it comes from ONE
// place: param_schema.json's "pluginAutomation" section. This renders it into
// packages/vst3/generated/automation_param_map.h for the plugin to include,
// with static_asserts pinning core's own copies of the constants (engine.h)
// to the same values - drift in either direction fails a build or CI.

function validateAutomationSection(schema) {
  const auto = schema.pluginAutomation
  if (!auto) throw new Error('param_schema.json is missing the "pluginAutomation" section')
  const { slotCount, paramsPerSlot, masterSlot } = auto
  if (!Number.isInteger(slotCount) || slotCount < 2) {
    throw new Error(`pluginAutomation.slotCount must be an integer >= 2 (got ${slotCount})`)
  }
  if (!Number.isInteger(paramsPerSlot) || paramsPerSlot < 1) {
    throw new Error(
      `pluginAutomation.paramsPerSlot must be a positive integer (got ${paramsPerSlot})`,
    )
  }
  if (!masterSlot || !Array.isArray(masterSlot.params) || masterSlot.params.length < 1) {
    throw new Error('pluginAutomation.masterSlot.params must be a non-empty array')
  }
  if (masterSlot.params.length > paramsPerSlot) {
    throw new Error('masterSlot has more params than paramsPerSlot allows')
  }

  // The whole point of the frozen stride: every kind/variant's param table
  // must fit inside one slot, today and until someone consciously bumps
  // paramsPerSlot (which remaps every host parameter id - see the design
  // note). Fail loudly here rather than silently truncating a kind's
  // automatable surface.
  const offenders = []
  for (const [kind, def] of Object.entries(schema.effects)) {
    const sets = def.variants ? Object.entries(def.variants) : [[null, def]]
    for (const [variant, set] of sets) {
      if (set.params.length > paramsPerSlot) {
        offenders.push(`${kind}${variant ? `/${variant}` : ''}: ${set.params.length}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `paramsPerSlot=${paramsPerSlot} is too small for: ${offenders.join(', ')}. ` +
        'Bump pluginAutomation.paramsPerSlot (a breaking change - see packages/vst3/README.md) ' +
        'or trim the offending param tables.',
    )
  }
  return auto
}

function cppStr(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderAutomationMap(auto) {
  const { slotCount, paramsPerSlot, masterSlot } = auto
  const master = masterSlot.params
  const blockSlots = slotCount - 1
  const total = master.length + blockSlots * paramsPerSlot

  // Normalized default per master param: where its native default sits in
  // [min, max]. Hosts read this at construction, before any rig exists.
  const defaults = master.map((p) => {
    const norm = (p.default - p.min) / (p.max - p.min)
    const clamped = Math.min(1, Math.max(0, norm))
    return cppFloat(clamped)
  })

  const lines = []
  lines.push('// GENERATED FILE - do not edit by hand.')
  lines.push('// Produced by scripts/gen-param-schema.mjs --target=automation-map from')
  lines.push('// packages/core/param_schema.json\'s "pluginAutomation" section.')
  lines.push('// The stable automation-parameter map plugin hosts see (issue #121; design')
  lines.push('// note and alternatives considered in ../README.md). The numbers below are')
  lines.push('// frozen API surface: changing any of them remaps every host parameter id.')
  lines.push('#pragma once')
  lines.push('')
  lines.push('#include <cstddef>')
  lines.push('')
  lines.push('#include "openaxe/engine.h"  // kAutomation* constants asserted below')
  lines.push('')
  lines.push('namespace openaxe::automation {')
  lines.push('')
  lines.push(`inline constexpr int kSlotCount = ${slotCount};`)
  lines.push(`inline constexpr int kParamsPerSlot = ${paramsPerSlot};`)
  lines.push('inline constexpr int kMasterSlotIndex = 0;  // permanently the master bus')
  lines.push('inline constexpr int kFirstBlockSlot = 1;')
  lines.push(`inline constexpr int kBlockSlotCount = ${blockSlots};`)
  lines.push(`inline constexpr int kMasterParamCount = ${master.length};`)
  lines.push(
    `inline constexpr int kTotalPluginParams = kMasterParamCount + kBlockSlotCount * kParamsPerSlot;  // = ${total}`,
  )
  lines.push('')
  lines.push('// Host parameter id of entry `entry` (0..kParamsPerSlot-1) on block slot')
  lines.push('// `slot` (kFirstBlockSlot..kSlotCount-1). Master slot entries precede all')
  lines.push('// block slots: id 0 is master level, id 1 master mute.')
  lines.push('inline constexpr int SlotParamId(int slot, int entry) {')
  lines.push('  return kMasterParamCount + (slot - kFirstBlockSlot) * kParamsPerSlot + entry;')
  lines.push('}')
  lines.push('')
  lines.push("// Slot 0's fixed descriptors, verbatim from the schema. Core mirrors these")
  lines.push('// in engine.h (kMasterAutomation*) so the ABI can resolve them without')
  lines.push('// including this generated header.')
  lines.push(
    `inline constexpr const char* kMasterSymbols[kMasterParamCount] = {${master.map((p) => cppStr(p.symbol)).join(', ')}};`,
  )
  lines.push(
    `inline constexpr const char* kMasterLabels[kMasterParamCount] = {${master.map((p) => cppStr(p.label)).join(', ')}};`,
  )
  lines.push(
    `inline constexpr float kMasterMin[kMasterParamCount] = {${master.map((p) => cppFloat(p.min)).join(', ')}};`,
  )
  lines.push(
    `inline constexpr float kMasterMax[kMasterParamCount] = {${master.map((p) => cppFloat(p.max)).join(', ')}};`,
  )
  lines.push(
    `inline constexpr const char* kMasterUnits[kMasterParamCount] = {${master.map((p) => cppStr(p.unit)).join(', ')}};`,
  )
  lines.push('// Native-unit default mapped into 0..1 - the construction-time position')
  lines.push('// hosts show before anything is loaded.')
  lines.push(
    `inline constexpr float kMasterDefaultNormalized[kMasterParamCount] = {${defaults.join(', ')}};`,
  )
  lines.push('')
  lines.push('// Compile-time string equality - static_asserting raw pointer == would')
  lines.push('// compare identities of distinct literals, which nothing guarantees.')
  lines.push('constexpr bool StrEq(const char* a, const char* b) {')
  lines.push("  while (*a != '\\0' && *a == *b) {")
  lines.push('    ++a;')
  lines.push('    ++b;')
  lines.push('  }')
  lines.push('  return *a == *b;')
  lines.push('}')
  lines.push('')
  lines.push("// Pin core's own copies of the constants to this file (both derive from the")
  lines.push('// same schema section; a mismatch means one side was hand-edited).')
  lines.push('static_assert(kSlotCount == openaxe::engine::kAutomationSlotCount,')
  lines.push('              "slot count drifted between param_schema.json and engine.h");')
  lines.push('static_assert(kParamsPerSlot == openaxe::engine::kAutomationParamsPerSlot,')
  lines.push('              "params-per-slot drifted between param_schema.json and engine.h");')
  lines.push('static_assert(kMasterParamCount <= openaxe::engine::kAutomationParamsPerSlot,')
  lines.push('              "master slot overflows the stride");')
  for (let i = 0; i < master.length; i++) {
    lines.push(
      `static_assert(StrEq(kMasterSymbols[${i}], openaxe::engine::kMasterAutomationSymbols[${i}]),`,
    )
    lines.push(`              "master param ${i} symbol drifted");`)
    lines.push(
      `static_assert(kMasterMin[${i}] == openaxe::engine::kMasterAutomationMin[${i}] &&` +
        ` kMasterMax[${i}] == openaxe::engine::kMasterAutomationMax[${i}],`,
    )
    lines.push(`              "master param ${master[i].symbol} range drifted");`)
  }
  lines.push('')
  lines.push('}  // namespace openaxe::automation')
  return lines.join('\n') + '\n'
}

// ── effects.config.json (issue #313) ────────────────────────────────────────
// Two flags per block kind: `compiled` (is the DSP source handed to the
// compiler at all) and `inPalette` (may a user place it). See the config's
// own $comment for why they are two and not one.

// "ping-pong-delay" -> "PING_PONG_DELAY", matching api.h's
// OPENAXE_BLOCK_* spelling so the two are greppable together.
function blockMacroSuffix(kind) {
  return kind.toUpperCase().replace(/-/g, '_')
}

// Config entries only - keys starting with $ are prose, and JSON has no
// comment syntax to put it in otherwise.
function blockEntries(config) {
  return Object.entries(config.blocks).filter(([key]) => !key.startsWith('$'))
}

function validateBlocksConfig(config) {
  const entries = blockEntries(config)
  if (entries.length === 0) throw new Error('effects.config.json declares no blocks')
  const seenEnums = new Set()
  for (const [kind, entry] of entries) {
    for (const field of ['enumName', 'compiled', 'inPalette']) {
      if (!(field in entry)) throw new Error(`block '${kind}' is missing '${field}'`)
    }
    if (typeof entry.compiled !== 'boolean' || typeof entry.inPalette !== 'boolean') {
      throw new Error(`block '${kind}': compiled/inPalette must be booleans`)
    }
    if (seenEnums.has(entry.enumName)) {
      throw new Error(`block '${kind}': duplicate enumName '${entry.enumName}'`)
    }
    seenEnums.add(entry.enumName)
    // A kind with no DSP source of its own cannot be compiled out: routing,
    // the NAM-model kinds, and anything handled inside engine.cpp.
    if (!entry.compiled && !entry.cppFile && !entry.cmakeGroup) {
      throw new Error(
        `block '${kind}' has no cppFile/cmakeGroup, so it has no source to omit - ` +
          `compiled:false is meaningless for it`,
      )
    }
    // Offering a block the build does not contain would put a placeable
    // entry in the palette that the core refuses to construct.
    if (!entry.compiled && entry.inPalette) {
      throw new Error(`block '${kind}': compiled:false requires inPalette:false`)
    }
  }
}

const GENERATED_HEADER_PLAIN = (source, comment) =>
  `${comment} GENERATED FILE - do not edit by hand.\n` +
  `${comment} Produced by scripts/gen-param-schema.mjs --target=effects from ${source}.\n`

function renderBlocksHeader(config) {
  const entries = blockEntries(config)
  const defines = entries
    .map(([kind, e]) => `#define OPENAXE_BLOCK_${blockMacroSuffix(kind)}_COMPILED ${e.compiled ? 1 : 0}`)
    .join('\n')
  const compiledCases = entries
    .map(([, e]) => `    case graph::BlockKind::${e.enumName}: return ${e.compiled};`)
    .join('\n')
  const paletteCases = entries
    .map(([, e]) => `    case graph::BlockKind::${e.enumName}: return ${e.inPalette};`)
    .join('\n')
  return `${GENERATED_HEADER_PLAIN('packages/core/effects.config.json', '//')}//
// One macro per block kind for the \`#if\` guards in engine.cpp, plus the two
// predicates the loader and the ABI use. Everything here is constexpr, so a
// compiled-out kind folds away rather than costing a runtime branch.
#pragma once

#include "openaxe/block.h"

${defines}

namespace openaxe::blocks {

// Whether this build contains the DSP for \`kind\`. A false here means
// AddBlock refuses the kind and the state loader drops it - see
// state::LoadOutcome::unsupported_blocks.
inline constexpr bool IsCompiled(graph::BlockKind kind) {
  switch (kind) {
${compiledCases}
  }
  return false;
}

// Whether the block palette offers \`kind\`. Independent of IsCompiled: a
// kind can be built and still withheld from the picker while its quality is
// being worked on (ring-mod, granular-delay today).
inline constexpr bool IsInPalette(graph::BlockKind kind) {
  switch (kind) {
${paletteCases}
  }
  return false;
}

}  // namespace openaxe::blocks
`
}

function renderBlocksCmake(config) {
  const entries = blockEntries(config)
  const sources = entries
    .filter(([, e]) => e.compiled && e.cppFile)
    .map(([, e]) => `  src/dsp/${e.cppFile}`)
    .join('\n')
  const omitted = entries.filter(([, e]) => !e.compiled).map(([kind]) => kind)
  const dragonfly = entries.find(([, e]) => e.cmakeGroup === 'dragonfly')
  const dragonflyOn = dragonfly ? dragonfly[1].compiled : false
  // Per-kind flags so tests/CMakeLists.txt can skip a compiled-out effect's
  // test target - it would otherwise fail to link against a DSP that is no
  // longer in the archive.
  const flags = entries
    .map(([kind, e]) => `set(OPENAXE_BLOCK_${blockMacroSuffix(kind)} ${e.compiled ? 'ON' : 'OFF'})`)
    .join('\n')
  return `${GENERATED_HEADER_PLAIN('packages/core/effects.config.json', '#')}#
# Included by packages/core/CMakeLists.txt. A block with compiled:false has
# its source omitted here entirely - it is never handed to the compiler, which
# is the whole point of the config.
${omitted.length > 0 ? `#\n# Omitted by effects.config.json: ${omitted.join(', ')}\n` : '#\n# Omitted by effects.config.json: (none)\n'}
set(OPENAXE_BLOCK_SOURCES
${sources}
)

# The four Dragonfly algorithms are separate targets with their own include
# paths and a C++14 override, so the reverb kind gates the whole group.
set(OPENAXE_DRAGONFLY_ENABLED ${dragonflyOn ? 'ON' : 'OFF'})

# One flag per kind, mirroring enabled_blocks.h's macros - tests/CMakeLists.txt
# gates each effect's test target on its own flag.
${flags}
`
}

function renderBlocksTs(config) {
  const entries = blockEntries(config)
  const list = (pred) =>
    entries
      .filter(([, e]) => pred(e))
      .map(([kind]) => `  '${kind}',`)
      .join('\n')
  return `${GENERATED_HEADER_PLAIN('packages/core/effects.config.json', '//')}//
// The palette and the block registry read these instead of hardcoding which
// kinds exist. COMPILED_BLOCK_KINDS is asserted against the running core at
// startup (see RigWorkletNode) so a stale prebuilt WASM cannot silently
// disagree with this file.
import type { BlockKind } from '../engine/blocks/Block'

/** Kinds whose DSP is in this build. The core refuses to construct any other. */
export const COMPILED_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
${list((e) => e.compiled)}
])

/** Kinds the block palette offers. Always a subset of COMPILED_BLOCK_KINDS. */
export const PALETTE_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
${list((e) => e.inPalette)}
])
`
}

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
  const files = new Map()

  if (selectedTargets.includes('base')) {
    validateSmoothing(schema)
    const { cppTargets, jsMaps, ranges } = buildTargets(schema)
    for (const target of cppTargets) {
      files.set(join(CPP_OUT_DIR, target.fragmentName), renderCppFragment(target))
      const smoothingName = target.fragmentName.replace('_params.inc', '_smoothing.inc')
      files.set(join(CPP_OUT_DIR, smoothingName), renderCppSmoothingFragment(target))
    }
    // Run through prettier so the checked-in file always matches what
    // `pnpm format`/CI expects - otherwise --check would flag its own output.
    const jsContent = await prettier.format(renderJsModule(jsMaps), {
      ...(await prettier.resolveConfig(JS_OUT_PATH)),
      filepath: JS_OUT_PATH,
    })
    files.set(JS_OUT_PATH, jsContent)

    const tsRangesContent = await prettier.format(renderTsRangesModule(ranges), {
      ...(await prettier.resolveConfig(TS_RANGES_OUT_PATH)),
      filepath: TS_RANGES_OUT_PATH,
    })
    files.set(TS_RANGES_OUT_PATH, tsRangesContent)
  }

  if (selectedTargets.includes('automation-map')) {
    // Validation first: a schema that outgrows the frozen stride is exactly
    // the drift this guard exists to catch (see validateAutomationSection).
    validateAutomationSection(schema)
    files.set(AUTOMATION_MAP_OUT_PATH, renderAutomationMap(schema.pluginAutomation))
  }

  if (selectedTargets.includes('effects')) {
    const blocksConfig = JSON.parse(readFileSync(BLOCKS_CONFIG_PATH, 'utf8'))
    validateBlocksConfig(blocksConfig)
    files.set(BLOCKS_HEADER_OUT_PATH, renderBlocksHeader(blocksConfig))
    files.set(BLOCKS_CMAKE_OUT_PATH, renderBlocksCmake(blocksConfig))
    const blocksTs = await prettier.format(renderBlocksTs(blocksConfig), {
      ...(await prettier.resolveConfig(BLOCKS_TS_OUT_PATH)),
      filepath: BLOCKS_TS_OUT_PATH,
    })
    files.set(BLOCKS_TS_OUT_PATH, blocksTs)
  }

  if (CHECK_ONLY) {
    let stale = []
    for (const [path, content] of files) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (current !== content) stale.push(path)
    }
    if (stale.length > 0) {
      console.error('Stale generated param files (run `node scripts/gen-param-schema.mjs` to fix):')
      for (const path of stale) console.error(`  ${path}`)
      process.exit(1)
    }
    console.log(`All ${files.size} generated param files are up to date.`)
    return
  }

  for (const path of files.keys()) mkdirSync(dirname(path), { recursive: true })
  for (const [path, content] of files) {
    writeFileSync(path, content)
  }
  console.log(
    `Wrote ${files.size} generated param file(s) [target: ${selectedTargets.join(', ')}].`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
