#!/usr/bin/env node
// Verifies the grid dimensions defined twice - TS (apps/web/src/engine/
// gridConfig.ts) and C++ (packages/core/include/openaxe/grid_config.h) -
// stay in sync. The C++ header is explicitly "Ported from gridConfig.ts",
// so TS is the source of truth and the C++ constants must match it.
//
// A desync breaks native/desktop OUT-rail connections: the C++ core sorts the
// OUT rail at column kGridCols while TS sorts it at GRID_COLS, so a block in a
// column allowed by the wider UI grid passes the TS pre-check but is rejected
// by the core (issue #61).
//
// Usage:
//   node scripts/check-grid-dims.mjs        # exit 1 on drift, no writes
//   node scripts/check-grid-dims.mjs --fix  # rewrite the C++ header to match TS
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TS_PATH = join(ROOT, 'apps/web/src/engine/gridConfig.ts')
const CPP_PATH = join(ROOT, 'packages/core/include/openaxe/grid_config.h')

const FIX = process.argv.includes('--fix')

function readInt(source, file, re, label) {
  const m = source.match(re)
  if (!m) {
    console.error(`check-grid-dims: could not find ${label} in ${file}`)
    process.exit(1)
  }
  return Number(m[1])
}

const tsSource = readFileSync(TS_PATH, 'utf8')
const cppSource = readFileSync(CPP_PATH, 'utf8')

const tsRows = readInt(tsSource, TS_PATH, /export const GRID_ROWS\s*=\s*(\d+)/, 'GRID_ROWS')
const tsCols = readInt(tsSource, TS_PATH, /export const GRID_COLS\s*=\s*(\d+)/, 'GRID_COLS')
const cppRows = readInt(cppSource, CPP_PATH, /kGridRows\s*=\s*(\d+)/, 'kGridRows')
const cppCols = readInt(cppSource, CPP_PATH, /kGridCols\s*=\s*(\d+)/, 'kGridCols')

const rowsMatch = tsRows === cppRows
const colsMatch = tsCols === cppCols

if (rowsMatch && colsMatch) {
  console.log(`Grid dims in sync: ${tsRows}x${tsCols} (TS == C++).`)
  process.exit(0)
}

console.error('Grid dims drifted between TS (source of truth) and C++:')
console.error(
  `  GRID_ROWS / kGridRows: ${tsRows} vs ${cppRows}${rowsMatch ? ' (ok)' : '  <-- MISMATCH'}`,
)
console.error(
  `  GRID_COLS / kGridCols: ${tsCols} vs ${cppCols}${colsMatch ? ' (ok)' : '  <-- MISMATCH'}`,
)

if (!FIX) {
  console.error(
    '\nRun `node scripts/check-grid-dims.mjs --fix` to rewrite the C++ header to match TS.',
  )
  process.exit(1)
}

const next = cppSource
  .replace(/kGridRows\s*=\s*\d+;/, `kGridRows = ${tsRows};`)
  .replace(/kGridCols\s*=\s*\d+;/, `kGridCols = ${tsCols};`)
writeFileSync(CPP_PATH, next)
console.log(`Rewrote ${CPP_PATH} to ${tsRows}x${tsCols}.`)
