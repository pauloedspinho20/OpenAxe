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
import { chmodSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
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

// macOS needs LaunchServices to be the launcher for TCC (issue #143). When a
// binary is exec'd straight from a shell/IDE, the *terminal* becomes the
// "responsible process" and macOS silently denies the microphone (no prompt,
// no sound). Launching the .app via `open` makes the bundle itself the
// responsible identity (com.namwebstudio.desktop), so the prompt fires and
// CoreAudio gets real input - exactly like the packaged build. `open` does not
// forward the parent environment, so dev.mjs writes the bits the app reads
// (NAM_STUDIO_UI_URL, NAM_DESKTOP_DEBUG, ...) to dev.env, which the bundle's
// launcher shell sources before exec'ing the real binary in the same process.
const LAUNCHER_SH = `#!/bin/sh
# Dev-bundle launcher (issue #143): the .app is opened via LaunchServices so
# macOS TCC attributes the mic prompt to the bundle; re-apply dev env then
# exec the real binary (same process keeps the bundle as responsible identity).
set -a
_DEV_ENV="$(dirname "$0")/../Resources/dev.env"
[ -f "$_DEV_ENV" ] && . "$_DEV_ENV"
set +a
_DEV_LOG="$(dirname "$0")/../Resources/dev.log"
exec "$(dirname "$0")/nam_desktop_bin" "$@" >"$_DEV_LOG" 2>&1
`

function launchMacOSBundle(rawExe) {
  const plistSrc = join(root, 'packaging', 'Info.plist')
  const appBundle = join(root, 'build', 'nam_desktop_dev.app')
  const macOsDir = join(appBundle, 'Contents', 'MacOS')
  const resDir = join(appBundle, 'Contents', 'Resources')
  const binInBundle = join(macOsDir, 'nam_desktop_bin')
  const launcher = join(macOsDir, 'nam_desktop')
  const plist = join(appBundle, 'Contents', 'Info.plist')
  const envFile = join(resDir, 'dev.env')
  const uiSrc = join(root, 'build', 'ui')
  const uiDst = join(resDir, 'ui')

  const uiMtime = existsSync(uiSrc) ? statSync(uiSrc).mtimeMs : 0
  const stale =
    !existsSync(binInBundle) ||
    !existsSync(plist) ||
    statSync(binInBundle).mtimeMs < statSync(rawExe).mtimeMs ||
    statSync(plist).mtimeMs < statSync(plistSrc).mtimeMs ||
    (uiMtime && (!existsSync(uiDst) || statSync(uiDst).mtimeMs < uiMtime))
  if (stale) {
    mkdirSync(macOsDir, { recursive: true })
    mkdirSync(resDir, { recursive: true })
    cpSync(rawExe, binInBundle)
    cpSync(plistSrc, plist)
    if (existsSync(uiSrc)) cpSync(uiSrc, uiDst, { recursive: true })
    writeFileSync(launcher, LAUNCHER_SH)
    chmodSync(launcher, 0o755)
    // Ad-hoc sign so LaunchServices/TCC have a stable code identity (the inner
    // binary's ld ad-hoc signature travels with the copy, but sign the whole
    // bundle so the .app itself is a coherent code object).
    try {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], {
        stdio: 'ignore',
      })
    } catch {
      console.warn(
        '[nam/desktop] ad-hoc codesign failed; the prompt may still fire via LaunchServices',
      )
    }
    console.log(`[nam/desktop] staged dev .app bundle -> ${appBundle}`)
  }

  // Forward only the env vars the app actually reads (open drops the parent
  // environment). --ui-url wins over any inherited NAM_STUDIO_UI_URL.
  const envLines = []
  if (uiUrl) envLines.push(`NAM_STUDIO_UI_URL='${uiUrl}'`)
  else if (process.env.NAM_STUDIO_UI_URL)
    envLines.push(`NAM_STUDIO_UI_URL='${process.env.NAM_STUDIO_UI_URL}'`)
  if (process.env.NAM_DESKTOP_DEBUG)
    envLines.push(`NAM_DESKTOP_DEBUG='${process.env.NAM_DESKTOP_DEBUG}'`)
  if (process.env.NAM_STUDIO_UI_DIR)
    envLines.push(`NAM_STUDIO_UI_DIR='${process.env.NAM_STUDIO_UI_DIR}'`)
  writeFileSync(envFile, envLines.join('\n') + (envLines.length ? '\n' : ''))

  const openArgs = ['-W', '-n', '-a', appBundle]
  if (appArgs.length) openArgs.push('--args', ...appArgs)
  console.log(`[nam/desktop] launching ${appBundle} via open (LaunchServices)`)
  console.log(`[nam/desktop] app logs -> ${join(resDir, 'dev.log')}`)
  execFileSync('open', openArgs, { stdio: 'inherit' })
}

if (process.platform === 'darwin') {
  launchMacOSBundle(exe)
} else {
  const env = { ...process.env }
  if (uiUrl) {
    env.NAM_STUDIO_UI_URL = uiUrl
    console.log(`[nam/desktop] UI from ${uiUrl} (dev server)`)
  }
  console.log(`[nam/desktop] launching ${exe}`)
  execFileSync(exe, appArgs, { stdio: 'inherit', env })
}
