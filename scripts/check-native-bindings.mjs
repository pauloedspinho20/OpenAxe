#!/usr/bin/env node
// Fail-fast guard for the Rosetta-pnpm wrong-arch install (issue #387).
// A plain `pnpm install` - the first thing anyone runs in a fresh worktree -
// otherwise succeeds while installing darwin-x64-only native bindings, and the
// breakage only surfaces minutes later as a 60-line "Cannot find native
// binding" stack trace inside vitest/oxlint that says nothing about pnpm.
//
// Wired as the root postinstall, so the fresh install itself reports the real
// cause with the repair command. Detection lives in
// scripts/lib/native-bindings.mjs (shared with setup.mjs, which owns the
// repair half).
//
// Usage:
//   node scripts/check-native-bindings.mjs        # exit 1 + remedy when broken
//   node scripts/check-native-bindings.mjs --fix  # repair via setup.mjs (web-only, no submodules)
//
// OPENAXE_SKIP_BINDING_CHECK=1 bypasses the check (exit 0). Only setup.mjs
// sets it, for its own internal `pnpm install`: that install is immediately
// followed by the wrong-arch detection + corrected reinstall, so gating it
// would deadlock the repair it exists to enable. Never set it yourself to
// silence a failure - the install is genuinely broken without the repair.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  declaredPnpmVersion,
  mismatchedNativeBindings,
  wantedPlatform,
} from './lib/native-bindings.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIX = process.argv.includes('--fix')

if (process.env.OPENAXE_SKIP_BINDING_CHECK) {
  console.log('check-native-bindings: skipped via OPENAXE_SKIP_BINDING_CHECK.')
  process.exit(0)
}

if (FIX) {
  const result = spawnSync('node', ['scripts/setup.mjs', '--web-only', '--skip-submodules'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  process.exit(result.status ?? 1)
}

const broken = mismatchedNativeBindings(ROOT)
const wanted = wantedPlatform()

if (broken.length === 0) {
  console.log(`check-native-bindings: native binaries match ${wanted}.`)
  process.exit(0)
}

const version = declaredPnpmVersion(ROOT)
console.error(
  `check-native-bindings: pnpm installed native binaries for the wrong architecture (this Node is ${wanted}):`,
)
for (const { family, installed } of broken) console.error(`  ${family}* -> ${installed.join(', ')}`)
console.error('pnpm resolves these from its own process architecture, so the pnpm on your')
console.error('PATH is running under emulation (an x86_64 build under Rosetta).')
console.error('Repair with:  node scripts/check-native-bindings.mjs --fix')
console.error(`Or permanently: npm i -g pnpm@${version} (make sure it shadows ~/Library/pnpm).`)
process.exit(1)
