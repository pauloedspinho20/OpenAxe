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
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
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

// On macOS, TCC only presents the microphone permission prompt — and persists
// the allow decision — for a properly bundled app that declares
// NSMicrophoneUsageDescription + a stable CFBundleIdentifier (issue #143). The
// raw binary at build/bin/nam_desktop has no .app wrapper, so dev mode gets no
// prompt and CoreAudio receives silence. Wrap it in a minimal .app that reuses
// packaging/Info.plist so dev mode is recognized as a real app like the
// packaged build. Other platforms don't gate mic access on an app bundle.
//
// Returns the path to actually exec: on non-macOS this is just `exe`; on macOS
// it's the executable inside a freshly staged .app bundle.
function getDevLaunchTarget(rawExe) {
  if (process.platform !== 'darwin') return rawExe

  const plist = join(root, 'packaging', 'Info.plist')
  const appBundle = join(root, 'build', 'nam_desktop_dev.app')
  const macOsDir = join(appBundle, 'Contents', 'MacOS')
  const bundleExe = join(macOsDir, 'nam_desktop')
  const bundlePlist = join(appBundle, 'Contents', 'Info.plist')

  const stale =
    !existsSync(bundleExe) ||
    !existsSync(bundlePlist) ||
    statSync(bundleExe).mtimeMs < statSync(rawExe).mtimeMs ||
    statSync(bundlePlist).mtimeMs < statSync(plist).mtimeMs
  if (stale) {
    mkdirSync(macOsDir, { recursive: true })
    cpSync(rawExe, bundleExe)
    cpSync(plist, bundlePlist)
    console.log(`[nam/desktop] staged dev .app bundle -> ${appBundle}`)
  }
  return bundleExe
}

const env = { ...process.env }
if (uiUrl) {
  env.NAM_STUDIO_UI_URL = uiUrl
  console.log(`[nam/desktop] UI from ${uiUrl} (dev server)`)
}

const launchExe = getDevLaunchTarget(exe)

console.log(`[nam/desktop] launching ${launchExe}`)
execFileSync(launchExe, appArgs, { stdio: 'inherit', env })
