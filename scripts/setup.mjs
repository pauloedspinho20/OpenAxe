// One-shot local setup, behind the "Setup: everything" VS Code task.
//
//   node scripts/setup.mjs [--web-only] [--skip-submodules] [--skip-cpp]
//                          [--submodules-only]
//
// --submodules-only backs the "C++: Init submodules" task, so the list of
// which submodules the C++ builds actually need lives here only.
//
// Idempotent: every step checks whether it already has what it needs and
// skips if so, so re-running after a failure is cheap and safe.
//
// Steps: git submodules -> pnpm install (+ native-binding repair, see below)
// -> CMake configure for packages/core and apps/desktop.
//
// The native-binding repair exists because pnpm picks a package's
// platform-specific optional dependencies from the architecture of *its own
// process*, not the Node that later loads them. A pnpm installed as the
// x86_64 build (~/Library/pnpm/.tools/@pnpm+macos-x64/...) running under
// Rosetta on an arm64 Mac therefore installs darwin-x64 binaries that arm64
// Node cannot load, and every build then dies inside rolldown/lightningcss/
// oxlint with "Cannot find native binding" and a 60-line stack trace that
// says nothing about the real cause. This script detects that outcome
// directly and reinstalls through an arch-correct pnpm.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanStaleCmakeCache } from './cmake-cache.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const webOnly = argv.includes('--web-only')
const submodulesOnly = argv.includes('--submodules-only')
const skipSubmodules = argv.includes('--skip-submodules')
const skipCpp = webOnly || argv.includes('--skip-cpp')

let step = 0
const heading = (text) => console.log(`\n[${++step}] ${text}\n${'-'.repeat(60)}`)
const ok = (text) => console.log(`  ok    ${text}`)
const skip = (text) => console.log(`  skip  ${text}`)
const warn = (text) => console.log(`  warn  ${text}`)

/** Run a command, streaming its output. Returns false instead of throwing. */
function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  return result.status === 0
}

/** Run a command and capture stdout; '' if it isn't installed or fails. */
function capture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function fail(message, hint) {
  console.error(`\nSetup failed: ${message}`)
  if (hint) console.error(hint)
  process.exit(1)
}

// ── 1. Toolchain ─────────────────────────────────────────────────────────

heading('Toolchain')
console.log(`  node    ${process.version} (${process.platform}/${process.arch})`)
const pnpmVersion = submodulesOnly ? 'n/a' : capture('pnpm', ['--version'])
if (!pnpmVersion) {
  fail(
    'pnpm is not on PATH.',
    'Install it with:  npm i -g pnpm@' +
      declaredPnpmVersion() +
      '\n' +
      'Use npm from the same Node you build with, so pnpm matches your architecture.',
  )
}
console.log(`  pnpm    ${pnpmVersion}`)
const cmake = submodulesOnly ? '' : (capture('cmake', ['--version']).split('\n')[0] ?? '')
console.log(`  cmake   ${cmake || 'not found (C++ steps will be skipped)'}`)

/** The pnpm version package.json pins, for the repair path and error hints. */
function declaredPnpmVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return String(pkg.packageManager ?? 'pnpm@latest')
      .split('@')
      .pop()
  } catch {
    return 'latest'
  }
}

// ── 2. Submodules ────────────────────────────────────────────────────────
//
// Only what the C++ builds actually include, and only when missing - a full
// `git submodule update --init --recursive` at the root pulls Eigen's entire
// history and takes minutes.

const submodules = [
  {
    name: 'dspark (effect DSP)',
    // packages/core/src/dsp/*.cpp include Effects/*.h from here unconditionally.
    sentinel: 'packages/core/third_party/dspark/Effects/Compressor.h',
    args: ['submodule', 'update', '--init', '--', 'packages/core/third_party/dspark'],
  },
  {
    name: 'nam-core + Eigen/AudioDSPTools',
    sentinel: 'packages/core/third_party/nam-core/Dependencies/eigen/Eigen/Dense',
    args: [
      'submodule',
      'update',
      '--init',
      '--recursive',
      '--',
      'packages/core/third_party/nam-core',
    ],
  },
  {
    name: 'daisysp (chorus DSP)',
    sentinel: 'packages/core/third_party/daisysp/Source/Effects/chorus.h',
    args: ['submodule', 'update', '--init', '--', 'packages/core/third_party/daisysp'],
  },
]

heading('Git submodules')
if (skipSubmodules) {
  skip('--skip-submodules')
} else if (skipCpp && !submodulesOnly) {
  skip('--web-only / --skip-cpp (the web app does not need them)')
} else {
  for (const module of submodules) {
    if (existsSync(join(root, module.sentinel))) {
      skip(module.name)
      continue
    }
    console.log(`  fetching ${module.name} - this can take a few minutes the first time`)
    if (!run('git', module.args, module.cwd ? { cwd: module.cwd } : {})) {
      fail(`could not fetch the ${module.name} submodule.`)
    }
    ok(module.name)
  }
}

// ── 3. Dependencies ──────────────────────────────────────────────────────

/**
 * Packages that ship one native binary per platform as optional dependencies.
 * pnpm installs only the ones matching its own process's platform/arch, so a
 * mismatch here is exactly the Rosetta-pnpm failure described at the top.
 * Keys are the prefix a virtual-store directory name starts with.
 */
const NATIVE_FAMILIES = [
  '@rolldown+binding-',
  '@oxlint+binding-',
  '@oxc-parser+binding-',
  '@oxc-resolver+binding-',
  'lightningcss-',
]
const PLATFORM_TOKEN = /(darwin|linux|win32)-(x64|arm64|ia32|arm)/

/**
 * Returns the families whose installed binaries are all for the wrong
 * platform/arch (an empty array means the install is usable). Reads directory
 * names in the virtual store rather than importing anything, so it costs
 * nothing and reports every broken family at once instead of the first.
 */
function mismatchedNativeBindings() {
  const storeDir = join(root, 'node_modules/.pnpm')
  if (!existsSync(storeDir)) return []
  const entries = readdirSync(storeDir)
  const wanted = `${process.platform}-${process.arch}`
  const broken = []
  for (const family of NATIVE_FAMILIES) {
    const installed = entries.filter((e) => e.startsWith(family) && PLATFORM_TOKEN.test(e))
    if (installed.length === 0) continue // family not used on this platform at all
    if (!installed.some((e) => e.includes(wanted))) {
      broken.push({ family, installed: installed.map((e) => e.replace(/@\d[\d.]*$/, '')) })
    }
  }
  return broken
}

heading('Dependencies')
if (submodulesOnly) skip('--submodules-only')
if (!submodulesOnly && !run('pnpm', ['install'])) fail('pnpm install failed.')

let broken = submodulesOnly ? [] : mismatchedNativeBindings()
if (broken.length > 0) {
  const wanted = `${process.platform}-${process.arch}`
  warn(`pnpm installed native binaries for the wrong architecture (this Node is ${wanted}):`)
  for (const { family, installed } of broken)
    console.log(`        ${family}* -> ${installed.join(', ')}`)
  warn('pnpm resolves these from its own process architecture, so the pnpm on')
  warn('your PATH is running under emulation. Reinstalling through npm, which')
  warn('runs pnpm on this Node instead:')

  const version = declaredPnpmVersion()
  if (!run('npm', ['exec', '--yes', `pnpm@${version}`, '--', 'install'])) {
    fail(
      'the architecture-corrected reinstall failed.',
      `Fix pnpm itself, then re-run this task:\n  npm i -g pnpm@${version}\n` +
        'and make sure the new pnpm comes first on PATH (an x86_64 build in\n' +
        '~/Library/pnpm will otherwise keep shadowing it).',
    )
  }

  broken = mismatchedNativeBindings()
  if (broken.length > 0) {
    fail(
      'native binaries are still wrong after the corrected reinstall.',
      `Replace pnpm permanently:\n  npm i -g pnpm@${version}\n  hash -r\n  pnpm exec node -p "process.arch"   # expect ${process.arch}`,
    )
  }
  ok('reinstalled with matching native binaries')
  warn(`this repair runs on every setup until you replace pnpm: npm i -g pnpm@${version}`)
} else if (!submodulesOnly) {
  ok(`native binaries match ${process.platform}/${process.arch}`)
}

// ── 4. C++ configure ─────────────────────────────────────────────────────
//
// Configure only: building is left to the C++/Desktop build tasks, so setup
// stays quick and a web-only contributor is never blocked by a compiler.

heading('C++ configure')
if (submodulesOnly) {
  skip('--submodules-only')
} else if (skipCpp) {
  skip('--web-only / --skip-cpp')
} else if (!cmake) {
  warn('cmake is not on PATH - skipping. The web app runs fine without it;')
  warn('see packages/core/README.md before running the C++ or Desktop tasks.')
} else {
  const configures = [
    [
      'packages/core',
      [
        '-S',
        'packages/core',
        '-B',
        'packages/core/build',
        '-DOPENAXE_BUILD_TESTS=ON',
        '-DCMAKE_BUILD_TYPE=Debug',
      ],
    ],
    [
      'apps/desktop',
      [
        '-S',
        'apps/desktop',
        '-B',
        'apps/desktop/build',
        '-DOPENAXE_DESKTOP_BUILD_TESTS=ON',
        '-DCMAKE_BUILD_TYPE=Debug',
      ],
    ],
  ]
  for (const [name, args] of configures) {
    // The Docker runner mounts this same tree at /work, so a cache written
    // there (or vice versa) must be dropped before reconfiguring.
    const buildFlag = args[args.indexOf('-B') + 1]
    const sourceFlag = args[args.indexOf('-S') + 1]
    cleanStaleCmakeCache(join(root, sourceFlag), join(root, buildFlag))
    if (!run('cmake', args)) fail(`cmake could not configure ${name}.`)
    ok(name)
  }
}

// ── Done ─────────────────────────────────────────────────────────────────

console.log(`
${'='.repeat(60)}
Setup complete. Next, from the VS Code task list:

  Web: Dev server                        the web app on its own
  Desktop: Dev (Debug build + launch)    the native shell + bundled UI
  Dev: web + desktop (parallel)          both at once
  C++: Build / C++: Test                 the shared DSP core
`)
