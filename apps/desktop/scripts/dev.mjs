// Dev launcher: builds the native desktop app (Debug) and runs it, forwarding
// any extra args to the binary.
//
//   node scripts/dev.mjs [--args-to-app ...]

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { run } from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Keep this in sync with build.mjs - dev always uses Debug.
run(true)

const exe = join(root, 'build', process.platform === 'win32' ? 'bin/nam_desktop.exe' : 'bin/nam_desktop')
if (!existsSync(exe)) {
  console.error(`[nam/desktop] binary not found: ${exe}`)
  process.exit(1)
}

console.log(`[nam/desktop] launching ${exe}`)
execFileSync(exe, process.argv.slice(2), { stdio: 'inherit' })