// Dev launcher: builds the native desktop app (Debug) and runs it.
//
//   node scripts/dev.mjs [--skip-ui] [--ui-url=<url>] [-- ...app args]
//
// Options:
//   --skip-ui        Don't rebuild/rebundle the web UI into build/ui (reuse
//                    whatever is already there). Much faster iteration when
//                    only the C++ side changed.
//   --ui-url=<url>   Point the webview at a URL instead of the bundled copy -
//                    typically the Vite dev server, so the native shell runs
//                    against `pnpm dev:web` with HMR. Implies --skip-ui.
//
// Anything after `--` (or any unrecognized arg) is forwarded to the binary.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { run } from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const ours = sep === -1 ? argv : argv.slice(0, sep)
const appArgs = sep === -1 ? [] : argv.slice(sep + 1)

const uiUrl = ours.find((a) => a.startsWith('--ui-url='))?.slice('--ui-url='.length)
const skipUi = ours.includes('--skip-ui') || Boolean(uiUrl)
// Unrecognized flags still go to the binary, so `dev -- --foo` stays optional.
appArgs.unshift(...ours.filter((a) => a !== '--skip-ui' && !a.startsWith('--ui-url=')))

// Keep this in sync with build.mjs - dev always uses Debug.
run(true, skipUi)

// Windows defaults to a Visual Studio generator (multi-config), which appends
// the config name to the runtime output dir; single-config generators
// (Makefiles/Ninja on macOS/Linux) don't. Try both.
const candidates =
  process.platform === 'win32'
    ? ['bin/Debug/nam_desktop.exe', 'bin/nam_desktop.exe']
    : ['bin/nam_desktop']
const exe = candidates.map((c) => join(root, 'build', c)).find(existsSync)
if (!exe) {
  console.error(
    `[nam/desktop] binary not found: ${candidates.map((c) => join(root, 'build', c)).join(', ')}`,
  )
  process.exit(1)
}

const env = { ...process.env }
if (uiUrl) {
  env.NAM_STUDIO_UI_URL = uiUrl
  console.log(`[nam/desktop] UI from ${uiUrl} (dev server)`)
}

console.log(`[nam/desktop] launching ${exe}`)
execFileSync(exe, appArgs, { stdio: 'inherit', env })
