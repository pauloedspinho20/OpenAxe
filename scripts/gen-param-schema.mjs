#!/usr/bin/env node
// Generates C++ param-table fragments and a JS symbol->index map module from
// packages/core/param_schema.json (issue #51's single source of truth for
// effect-param names/symbols/ranges). Run with --check to verify the
// checked-in generated files are up to date instead of overwriting them (used
// in CI to fail the build on drift - see .github/workflows/ci.yml).
//
// Usage:
//   node scripts/gen-param-schema.mjs          # regenerate in place
//   node scripts/gen-param-schema.mjs --check  # exit 1 if stale, no writes

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA_PATH = join(ROOT, 'packages/core/param_schema.json')
const CPP_OUT_DIR = join(ROOT, 'packages/core/src/dsp/generated')
const JS_OUT_PATH = join(ROOT, 'apps/web/public/wasm-core/generatedParams.js')

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

function jsIdent(kind) {
  return kind
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase())
}

function buildTargets(schema) {
  // Each target is one generated C++ .inc fragment: {fragmentName, params}.
  const cppTargets = []
  // One JS symbol->index map per effect kind, keyed by variant name where the
  // effect has model variants (drive, reverb), or a flat map otherwise.
  const jsMaps = {}

  for (const [kind, def] of Object.entries(schema.effects)) {
    if (def.variants) {
      const perVariant = {}
      for (const [variantKey, variant] of Object.entries(def.variants)) {
        if (variant.cppFile) {
          cppTargets.push({
            fragmentName: cppFragmentName(variant.cppFile, null),
            params: variant.params,
          })
        }
        perVariant[variantKey] = Object.fromEntries(
          variant.params.map((p, i) => [p.symbol, i]),
        )
      }
      jsMaps[kind] = perVariant
    } else {
      if (def.cppFile) {
        cppTargets.push({ fragmentName: cppFragmentName(def.cppFile, null), params: def.params })
      }
      jsMaps[kind] = Object.fromEntries(def.params.map((p, i) => [p.symbol, i]))
    }
  }
  return { cppTargets, jsMaps }
}

function renderCppFragment(target) {
  return GENERATED_HEADER_CPP('packages/core/param_schema.json') + target.params.map(cppRow).join('\n') + '\n'
}

function renderJsModule(jsMaps) {
  const lines = [GENERATED_HEADER_JS('packages/core/param_schema.json')]
  for (const [kind, value] of Object.entries(jsMaps)) {
    const constName = jsIdent(kind).toUpperCase() + '_PARAMS'
    const isVariantMap = !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'object')
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

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
  const { cppTargets, jsMaps } = buildTargets(schema)

  const files = new Map()
  for (const target of cppTargets) {
    files.set(join(CPP_OUT_DIR, target.fragmentName), renderCppFragment(target))
  }
  // Run through prettier so the checked-in file always matches what
  // `pnpm format`/CI expects - otherwise --check would flag its own output.
  const jsContent = await prettier.format(renderJsModule(jsMaps), {
    ...(await prettier.resolveConfig(JS_OUT_PATH)),
    filepath: JS_OUT_PATH,
  })
  files.set(JS_OUT_PATH, jsContent)

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

  mkdirSync(CPP_OUT_DIR, { recursive: true })
  for (const [path, content] of files) {
    writeFileSync(path, content)
  }
  console.log(`Wrote ${files.size} generated param files.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
