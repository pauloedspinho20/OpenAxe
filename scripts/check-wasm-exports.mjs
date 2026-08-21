#!/usr/bin/env node
// Verifies every WASM ABI symbol (_nam_studio_*, _malloc, _free) referenced
// by web/worklet source is present in packages/core/CMakeLists.txt's
// hand-maintained EXPORTED_FUNCTIONS list (issue #70).
//
// Emscripten silently makes an unexported symbol `undefined` on the JS
// Module object - calling it throws a TypeError at runtime, not at wasm
// build time - so a missing export can't be caught by the wasm build
// itself. This instead greps the actual source for every `_nam_studio_*`
// identifier the web app calls and diffs that against what's exported,
// the same drift-check shape as check-grid-dims.mjs (issue #61).
//
// Usage:
//   node scripts/check-wasm-exports.mjs        # exit 1 on drift, no writes
//   node scripts/check-wasm-exports.mjs --fix  # add missing symbols to CMakeLists.txt
//                                               # (still requires a wasm rebuild - see
//                                               # scripts/build-core-wasm.sh)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CMAKE_PATH = join(ROOT, 'packages/core/CMakeLists.txt')
const SCAN_DIRS = [join(ROOT, 'apps/web/src'), join(ROOT, 'apps/web/public/wasm-core')]
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])

const FIX = process.argv.includes('--fix')

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === 'node_modules') continue
      collectFiles(path, out)
    } else if (SCAN_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      out.push(path)
    }
  }
  return out
}

const files = SCAN_DIRS.flatMap((dir) => collectFiles(dir, []))

const SYMBOL_RE = /\b(_nam_studio_[a-zA-Z0-9_]+|_malloc|_free)\b/g
const used = new Set()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(SYMBOL_RE)) used.add(match[1])
}

const cmakeSource = readFileSync(CMAKE_PATH, 'utf8')
const listMatch = cmakeSource.match(/EXPORTED_FUNCTIONS=\[([^\]]*)\]/)
if (!listMatch) {
  console.error(`check-wasm-exports: could not find EXPORTED_FUNCTIONS in ${CMAKE_PATH}`)
  process.exit(1)
}
const exported = new Set(
  listMatch[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean),
)

const missing = [...used].filter((symbol) => !exported.has(symbol)).sort()

if (missing.length === 0) {
  console.log(`WASM exports in sync: ${used.size} symbol(s) used by web source, all exported.`)
  process.exit(0)
}

console.error('WASM ABI symbols used by web source but missing from EXPORTED_FUNCTIONS:')
for (const symbol of missing) console.error(`  ${symbol}`)

if (!FIX) {
  console.error(
    `\nAdd these to EXPORTED_FUNCTIONS in ${CMAKE_PATH} and re-run ` +
      'scripts/build-core-wasm.sh, or run `node scripts/check-wasm-exports.mjs --fix` ' +
      'to add them automatically (a wasm rebuild is still required after).',
  )
  process.exit(1)
}

const nextList = [...exported, ...missing].sort()
const nextLine = `EXPORTED_FUNCTIONS=[${nextList.map((symbol) => `'${symbol}'`).join(',')}]`
writeFileSync(CMAKE_PATH, cmakeSource.replace(/EXPORTED_FUNCTIONS=\[[^\]]*\]/, nextLine))
console.log(
  `Added ${missing.length} symbol(s) to ${CMAKE_PATH}. Re-run scripts/build-core-wasm.sh to rebuild the wasm binary.`,
)
