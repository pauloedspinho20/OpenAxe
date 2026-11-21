#!/usr/bin/env node
// Collect built plugin bundles (.vst3/.component/.clap, files or dirs) into
// one zip per platform (issue #427 Phase 3). Cross-platform: `zip -r` on
// macOS/Linux, Compress-Archive on Windows.
//
//   node scripts/collect-plugin-bundles.mjs --platform=macos|linux|windows [--tag=v0.2.8]
//   [--build-dir=packages/vst3/build] [--out=<path>] [--allow-empty]
//
// --tag defaults to process.env.CI_COMMIT_TAG. Fails loudly when nothing is
// found (mirrors the old plugin.yml fail_on_unmatched_files behavior) unless
// --allow-empty: on Linux the plugin builds headless with no IGraphics backend
// and the VST3/CLAP SDKs aren't fetched, so no bundles exist — pass
// --allow-empty to log a warning and skip instead of failing the release.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUNDLE_EXTS = ['.vst3', '.component', '.clap']

function parseArgs(argv) {
  const opts = {
    platform: '',
    tag: process.env.CI_COMMIT_TAG || '',
    buildDir: 'packages/vst3/build',
    out: '',
    allowEmpty: false,
  }
  for (const arg of argv) {
    if (arg.startsWith('--platform=')) opts.platform = arg.slice(11)
    else if (arg.startsWith('--tag=')) opts.tag = arg.slice(6)
    else if (arg.startsWith('--build-dir=')) opts.buildDir = arg.slice(12)
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6)
    else if (arg === '--allow-empty') opts.allowEmpty = true
    else throw new Error(`Unknown flag: ${arg}`)
  }
  if (!['macos', 'linux', 'windows'].includes(opts.platform)) {
    throw new Error('Missing/invalid --platform=macos|linux|windows')
  }
  if (!opts.tag) throw new Error('Missing --tag (or CI_COMMIT_TAG)')
  opts.out ||= join(opts.buildDir, `openaxe-plugin-bundles-${opts.platform}-${opts.tag}.zip`)
  return opts
}

function findBundles(dir, depth = 0) {
  if (!existsSync(dir) || depth > 2) return []
  const hits = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === '_deps' || entry === 'CMakeFiles') continue
    const full = join(dir, entry)
    if (BUNDLE_EXTS.some((ext) => entry.endsWith(ext))) hits.push(full)
    else if (statSync(full).isDirectory()) hits.push(...findBundles(full, depth + 1))
  }
  return hits
}

function zipPosix(out, files, cwd) {
  try {
    execFileSync('zip', ['-qr', out, ...files], { stdio: 'inherit', cwd })
  } catch {
    // zip(1) absent (minimal images) — cmake's tar is always beside our builds.
    execFileSync('cmake', ['-E', 'tar', 'cf', out, '--format=zip', '--', ...files], {
      stdio: 'inherit',
      cwd,
    })
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const bundles = [...new Set(findBundles(opts.buildDir))].sort()
  if (bundles.length === 0) {
    if (opts.allowEmpty) {
      console.warn(
        `[bundles] WARN: no plugin bundles (*.vst3/*.component/*.clap) under ${opts.buildDir} — ` +
          `skipping (${opts.platform} builds the plugin headless; no GUI bundles are produced)`,
      )
      return
    }
    throw new Error(`No plugin bundles (*.vst3/*.component/*.clap) under ${opts.buildDir}`)
  }
  console.log(`[bundles] ${bundles.length} bundle(s):\n  ${bundles.join('\n  ')}`)
  // Zip entries relative to the build dir, so unzipping yields
  // `OpenAxe.component/…`, not the repo path `packages/vst3/build/…`.
  const base = resolve(opts.buildDir)
  const entries = bundles.map((b) => relative(base, b))

  // GPLv3 (section 4) requires the license to be conveyed with the work, and
  // the permissive dependencies require their notices to travel with the
  // binary too — a link in the repo is not distribution. Stage both into the
  // build dir so they zip as top-level entries beside the bundles.
  // See THIRD_PARTY_NOTICES.md and licenses/README.md.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const staged = []
  const licensesDir = join(repoRoot, 'licenses')
  if (existsSync(licensesDir)) {
    cpSync(licensesDir, join(base, 'licenses'), { recursive: true })
    staged.push('licenses')
  } else {
    console.warn('[bundles] WARN: licenses/ missing — run node scripts/sync-licenses.mjs')
  }
  const gpl = join(repoRoot, 'LICENSE')
  if (existsSync(gpl)) {
    cpSync(gpl, join(base, 'LICENSE'))
    staged.push('LICENSE')
  }
  entries.push(...staged)
  // zip(1) appends to an existing archive — start clean so a re-run never
  // leaves stale entries (e.g. an earlier repo-relative path layout).
  rmSync(opts.out, { force: true })
  if (process.platform === 'win32') {
    const list = [...bundles, ...staged.map((e) => join(base, e))].map((b) => `'${b}'`).join(',')
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path ${list} -DestinationPath '${opts.out}' -Force`,
      ],
      { stdio: 'inherit' },
    )
  } else {
    zipPosix(resolve(opts.out), entries, base)
  }
  console.log(`[bundles] wrote ${opts.out}`)
}

try {
  main()
} catch (err) {
  console.error(`[bundles] FATAL: ${err.message}`)
  process.exit(1)
}
