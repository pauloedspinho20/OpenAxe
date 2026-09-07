// Local CI — mirrors the GitHub PR legs without needing GitHub.
//
//   pnpm ci:local                          # everything, macOS native
//   pnpm ci:local --stage=drift,lint       # subset (repeatable / comma-separated)
//   pnpm ci:local --skip=e2e,plugin        # everything except these
//   pnpm ci:local --with-storybook         # also build Storybook (CI only does this on push to main/dev)
//   pnpm ci:local --e2e-full               # full 4-project Playwright matrix (default is chromium-only, like CI PRs)
//   pnpm ci:local --no-fail-fast           # run every stage even after a failure
//   pnpm ci:local --skip-setup             # skip the setup stage (submodules + pnpm install + CMake configure)
//
// What it covers (see .github/workflows/ci.yml, desktop.yml, plugin.yml):
//   setup   — node scripts/setup.mjs (submodules + pnpm install + CMake configure)
//   drift   — the 7 drift guards from ci.yml `checks`, in CI order
//   lint    — pnpm lint + pnpm format:check
//   build   — pnpm build (web + ui; desktop excluded, same as CI)
//   unit    — pnpm test:run
//   e2e     — Playwright chromium-desktop + chromium-mobile (CI PR variant)
//   core    — packages/core CMake Release configure + build + ctest (ci.yml core-tests)
//   desktop — pnpm --filter @openaxe/desktop build (desktop.yml PR leg: compile+link, no CPack)
//   plugin  — packages/vst3 Release configure + build + ctest -LE validator (plugin.yml PR leg)
//
// What it deliberately does NOT cover:
//   - Windows legs. Windows containers need a Windows kernel, so Docker on
//     macOS cannot run them. Push / use the `full-ci` label for those.
//   - Signing, CPack packaging, artifact uploads, Cloudflare deploy, and the
//     auto-release / release tag flows — those only run on merge/tag in CI.
//   - The Linux 3-OS matrix — use pnpm ci:local:linux (docker/ci-linux/) for
//     the ubuntu-24.04 leg in Docker.
//
// Exit code is 0 only if every executed stage passed. Validators
// (ctest -L validator) warn-but-pass when their host tools are absent,
// exactly like CI's `|| true` step.

import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const STAGES = ['setup', 'drift', 'lint', 'build', 'unit', 'e2e', 'core', 'desktop', 'plugin']

function parseArgs(argv) {
  const opts = {
    stages: null,
    skip: new Set(),
    failFast: true,
    withStorybook: false,
    e2eFull: false,
    skipSetup: false,
    help: false,
    error: false,
  }
  for (const arg of argv) {
    if (arg === '--no-fail-fast') opts.failFast = false
    else if (arg === '--with-storybook') opts.withStorybook = true
    else if (arg === '--e2e-full') opts.e2eFull = true
    else if (arg === '--skip-setup') opts.skipSetup = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('--stage=')) {
      opts.stages ??= []
      opts.stages.push(...arg.slice('--stage='.length).split(',').filter(Boolean))
    } else if (arg.startsWith('--skip=')) {
      for (const s of arg.slice('--skip='.length).split(',').filter(Boolean)) opts.skip.add(s)
    } else {
      console.error(`Unknown argument: ${arg}`)
      opts.help = true
      opts.error = true
    }
  }
  if (opts.skipSetup) opts.skip.add('setup')
  const selected = opts.stages ?? STAGES
  const unknown = selected.filter((s) => !STAGES.includes(s))
  if (unknown.length > 0) {
    console.error(`Unknown stage(s): ${unknown.join(', ')} (valid: ${STAGES.join(', ')})`)
    opts.help = true
    opts.error = true
  }
  for (const s of opts.skip) {
    if (!STAGES.includes(s)) {
      console.error(`Unknown stage in --skip: ${s} (valid: ${STAGES.join(', ')})`)
      opts.help = true
      opts.error = true
    }
  }
  opts.selected = selected.filter((s) => !opts.skip.has(s))
  return opts
}

function printHelp() {
  console.log(`Local CI — mirrors the GitHub PR legs locally.

Usage: node scripts/ci-local.mjs [--stage=<name>] [--skip=<name>] [flags]

Stages: ${STAGES.join(', ')}
Flags:
  --stage=<a,b>     run only these stages (repeatable)
  --skip=<a,b>      skip these stages
  --skip-setup      skip the setup stage
  --with-storybook  also run pnpm build-storybook (CI: push to main/dev only)
  --e2e-full        full Playwright matrix (default: chromium projects only, like CI PRs)
  --no-fail-fast    run all stages even after a failure
  --help            this text

npm aliases: pnpm ci:local, pnpm ci:local:linux (ubuntu-24.04 in Docker)
Windows legs cannot run locally on macOS — they stay on GitHub (full-ci label).`)
}

let stepNo = 0
const results = []

/** Run one command, streaming output. Returns true on success. */
function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  return result.status === 0
}

/** ccache ships in CI (apt/brew) but is optional locally — wiring it as the
 *  compiler launcher when it isn't installed fails the build outright. When
 *  absent we pass an explicit empty launcher instead of omitting the flag:
 *  a build dir configured by an earlier ccache run keeps the stale value in
 *  CMakeCache.txt otherwise. */
function hasCcache() {
  return spawnSync('ccache', ['--version'], { stdio: 'ignore' }).status === 0
}

function ccacheHint() {
  console.log(
    '  hint  ccache not on PATH — building uncached (CI installs it; `brew install ccache` speeds up local rebuilds)',
  )
}

function stage(name, title, fn) {
  const started = Date.now()
  console.log(`\n[${++stepNo}] ${title}\n${'-'.repeat(60)}`)
  const ok = fn()
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name} (${secs}s)`)
  results.push({ name, ok })
  return ok
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || opts.selected.length === 0) {
    printHelp()
    process.exit(opts.error || (!opts.help && opts.selected.length === 0) ? 1 : 0)
  }
  console.log(
    `Local CI stages: ${opts.selected.join(' → ')}${opts.failFast ? '' : ' (no fail-fast)'}`,
  )

  const runners = {
    setup: () => run('node', ['scripts/setup.mjs']),

    drift: () =>
      run('node', ['scripts/gen-param-schema.mjs', '--check']) &&
      run('node', ['scripts/gen-param-schema.mjs', '--check', '--target=automation-map']) &&
      run('node', ['scripts/gen-param-schema.mjs', '--check', '--target=effects']) &&
      run('node', ['scripts/check-grid-dims.mjs']) &&
      run('node', ['scripts/check-wasm-exports.mjs']) &&
      run('node', ['scripts/sync-version.mjs', '--check']) &&
      run('node', ['packages/ui/scripts/generate-tokens.mjs', '--check']),

    lint: () => run('pnpm', ['lint']) && run('pnpm', ['format:check']),

    build: () => run('pnpm', ['build']),

    unit: () => run('pnpm', ['test:run']),

    e2e: () => {
      if (opts.e2eFull) return run('pnpm', ['test:e2e'])
      const ok = run('pnpm', [
        '--filter',
        '@openaxe/web',
        'exec',
        'playwright',
        'test',
        '--project=chromium-desktop',
        '--project=chromium-mobile',
      ])
      if (!ok) {
        console.log(
          '  hint  missing browsers? run: pnpm --filter @openaxe/web exec playwright install chromium',
        )
      }
      return ok
    },

    // ci.yml core-tests: Release + ccache launcher when available, Ninja when available.
    core: () => {
      try {
        const probe = spawnSync('ninja', ['--version'], { stdio: 'ignore' })
        const generator = probe.status === 0 ? ['-G', 'Ninja'] : []
        let launcher = ['-DCMAKE_CXX_COMPILER_LAUNCHER=']
        if (hasCcache()) {
          launcher = ['-DCMAKE_CXX_COMPILER_LAUNCHER=ccache']
        } else {
          ccacheHint()
        }
        return (
          run('cmake', [
            '-S',
            'packages/core',
            '-B',
            'packages/core/build',
            ...generator,
            '-DCMAKE_BUILD_TYPE=Release',
            '-DOPENAXE_BUILD_TESTS=ON',
            ...launcher,
          ]) &&
          run('cmake', ['--build', 'packages/core/build', '-j']) &&
          run('ctest', ['--test-dir', 'packages/core/build', '--output-on-failure', '-j2'])
        )
      } catch {
        return false
      }
    },

    // desktop.yml PR leg: compile + link only, no CPack/uploads.
    desktop: () => {
      const env = { ...process.env }
      if (hasCcache()) {
        env.CMAKE_CXX_COMPILER_LAUNCHER = 'ccache'
        env.CMAKE_C_COMPILER_LAUNCHER = 'ccache'
      } else {
        ccacheHint()
      }
      return run('pnpm', ['--filter', '@openaxe/desktop', 'build'], { env })
    },

    // plugin.yml PR leg: web UI already built by the `build` stage; configure
    // Release, build, run non-validator tests, then validators as warn-only
    // (each SKIPs when its host tool is absent — CI's `|| true` step).
    plugin: () => {
      let launchers = ['-DCMAKE_CXX_COMPILER_LAUNCHER=', '-DCMAKE_C_COMPILER_LAUNCHER=']
      if (hasCcache()) {
        launchers = ['-DCMAKE_CXX_COMPILER_LAUNCHER=ccache', '-DCMAKE_C_COMPILER_LAUNCHER=ccache']
      } else {
        ccacheHint()
      }
      const configured = run('cmake', [
        '-S',
        'packages/vst3',
        '-B',
        'packages/vst3/build',
        '-DCMAKE_BUILD_TYPE=Release',
        '-DOPENAXE_BUILD_TESTS=OFF',
        ...launchers,
      ])
      if (!configured) return false
      if (!run('cmake', ['--build', 'packages/vst3/build', '--config', 'Release', '-j']))
        return false
      if (
        !run('ctest', [
          '--test-dir',
          'packages/vst3/build',
          '-C',
          'Release',
          '--output-on-failure',
          '-LE',
          'validator',
        ])
      )
        return false
      if (
        !run('ctest', [
          '--test-dir',
          'packages/vst3/build',
          '-C',
          'Release',
          '--output-on-failure',
          '-L',
          'validator',
        ])
      ) {
        console.log(
          '  warn  validator tests failed — CI treats these as warn-only when host tools are absent',
        )
      }
      return true
    },
  }

  const titles = {
    setup: 'Setup (submodules + pnpm install + CMake configure)',
    drift: 'Drift guards (param schema, grid, wasm exports, version, tokens)',
    lint: 'Lint + format check',
    build: 'Typecheck & build (web + ui)',
    unit: 'Unit tests (Vitest)',
    e2e: `E2E tests (Playwright${opts.e2eFull ? ', full matrix' : ', chromium projects'})`,
    core: 'C++ core tests (Release)',
    desktop: 'Desktop app (compile + link, no packaging)',
    plugin: 'Plugin (configure + build + tests)',
  }

  for (const name of opts.selected) {
    const ok = stage(name, titles[name], runners[name])
    if (!ok && opts.failFast) break
  }

  if (opts.withStorybook) {
    stage('storybook', 'Storybook static build', () => run('pnpm', ['build-storybook']))
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${'='.repeat(60)}`)
  console.log(
    failed.length === 0
      ? `Local CI passed (${results.map((r) => r.name).join(', ')}).`
      : `Local CI FAILED: ${failed.map((r) => r.name).join(', ')}.`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

main()
