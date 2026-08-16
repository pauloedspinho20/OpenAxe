// Builds the native desktop app. The CMake project (apps/desktop) pulls in
// the shared C++ DSP core (packages/core) and the webview shell, then
// produces the platform binary (bin/nam_desktop on macOS/Linux,
// nam_desktop.exe on Windows).
//
//   node scripts/build.mjs [--debug]
//
// Options:
//   --debug   Configure with CMAKE_BUILD_TYPE=Debug (default: Release).
//
// Exports run(debug) so dev.mjs can reuse the same configure+build steps.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))  // apps/desktop
const repoRoot = dirname(dirname(root))                        // monorepo root
const buildDir = join(root, 'build')

// Build the React UI (issue #15 M3) with a relative base so it can be served
// from a file:// URL, then bundle it next to the native binary at build/ui.
function bundleUi() {
  console.log('[nam/desktop] building web UI (apps/web build:desktop)...')
  execFileSync('pnpm', ['--filter', '@nam/web', 'build:desktop'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  const dist = join(repoRoot, 'apps/web/dist')
  const uiDir = join(buildDir, 'ui')
  if (!existsSync(dist)) {
    console.error('[nam/desktop] web build produced no dist/ - cannot bundle UI')
    process.exit(1)
  }
  mkdirSync(uiDir, { recursive: true })
  cpSync(dist, uiDir, { recursive: true })
  console.log(`[nam/desktop] bundled UI -> ${uiDir}`)
}

export function run(debug, skipUi = false) {
  const buildType = debug ? 'Debug' : 'Release'
  if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true })

  console.log(`[nam/desktop] configuring CMake (${buildType})...`)
  execFileSync(
    'cmake',
    ['-S', root, '-B', buildDir, `-DCMAKE_BUILD_TYPE=${buildType}`],
    { stdio: 'inherit' },
  )

  console.log('[nam/desktop] building...')
  execFileSync('cmake', ['--build', buildDir, '--config', buildType], {
    stdio: 'inherit',
  })

  if (!skipUi) bundleUi()

  console.log('[nam/desktop] done.')
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isCli) {
  const debug = process.argv.includes('--debug')
  const skipUi = process.argv.includes('--skip-ui')
  run(debug, skipUi)
}