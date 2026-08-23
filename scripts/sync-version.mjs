#!/usr/bin/env node
// The root VERSION file is the one source of truth for the product's
// version (issue #54) - every package.json's "version" field is kept in
// sync with it here, and apps/desktop's and packages/core's CMakeLists.txt
// read the same file directly (see their comments), so the built installer's
// filename and every package's own version never drift apart again.
//
// Usage:
//   node scripts/sync-version.mjs          # rewrite in place
//   node scripts/sync-version.mjs --check  # exit 1 if any package.json is stale, no writes
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSION_PATH = join(ROOT, 'VERSION')
const PACKAGE_JSON_PATHS = [
  'package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'packages/ui/package.json',
].map((p) => join(ROOT, p))

const CHECK_ONLY = process.argv.includes('--check')

const version = readFileSync(VERSION_PATH, 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`sync-version: VERSION file must be a plain semver "x.y.z", got "${version}"`)
  process.exit(1)
}

let stale = []
for (const path of PACKAGE_JSON_PATHS) {
  const source = readFileSync(path, 'utf8')
  const pkg = JSON.parse(source)
  if (pkg.version === version) continue
  stale.push(path)

  if (CHECK_ONLY) continue
  const next = source.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`)
  writeFileSync(path, next)
}

if (stale.length === 0) {
  console.log(
    `Versions in sync: ${version} across ${PACKAGE_JSON_PATHS.length} package.json file(s).`,
  )
  process.exit(0)
}

if (CHECK_ONLY) {
  console.error(`VERSION is ${version}, but these package.json files disagree:`)
  for (const path of stale) console.error(`  ${path}`)
  console.error('\nRun `node scripts/sync-version.mjs` to fix.')
  process.exit(1)
}

console.log(`Synced ${stale.length} package.json file(s) to ${version}.`)
