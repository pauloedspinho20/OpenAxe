#!/usr/bin/env node
// Collect verbatim third-party license texts into licenses/ (issue: go-public
// licensing pass).
//
//   node scripts/sync-licenses.mjs            # write licenses/*.txt
//   node scripts/sync-licenses.mjs --check    # fail if a committed text drifted
//
// WHY THIS EXISTS. OpenAxe ships under GPLv3, which does not dissolve the
// terms of the permissive code it links. MIT, BSD, zlib and MPL-2.0 all
// require their copyright notice and permission text to travel WITH the
// distribution — in the .dmg/.deb/.zip and the plugin bundles, not merely as
// a link in a repo file. licenses/ is that payload; packaging copies it in.
//
// Sources are read from the submodules and the CMake FetchContent build trees,
// so a source that has not been checked out or built yet is SKIPPED rather
// than failing: CI legs that never configure the plugin still pass --check.
// That also means a full refresh needs a configured desktop + plugin build.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'licenses')

/** Pull the trailing license comment out of a single-header library. */
function fromHeader(file, startMarker) {
  const text = readFileSync(file, 'utf8')
  const at = text.indexOf(startMarker)
  if (at === -1) throw new Error(`marker not found in ${file}`)
  const end = text.indexOf('*/', at)
  return text.slice(at, end === -1 ? undefined : end).trimEnd() + '\n'
}

const SOURCES = [
  {
    name: 'NeuralAmpModelerCore',
    file: 'NeuralAmpModelerCore.txt',
    from: 'packages/core/third_party/nam-core/LICENSE',
  },
  {
    name: 'AudioDSPTools (via NeuralAmpModelerCore)',
    file: 'AudioDSPTools.txt',
    from: 'packages/core/third_party/nam-core/Dependencies/AudioDSPTools/LICENSE',
  },
  {
    name: 'Eigen (via NeuralAmpModelerCore)',
    file: 'Eigen.txt',
    from: 'packages/core/third_party/nam-core/Dependencies/eigen/COPYING.MPL2',
    // Eigen is primarily MPL-2.0 but carries BSD/Apache/MINPACK files too;
    // ship its own COPYING.README so that is not misrepresented.
    prepend: 'packages/core/third_party/nam-core/Dependencies/eigen/COPYING.README',
  },
  { name: 'DSPark', file: 'DSPark.txt', from: 'packages/core/third_party/dspark/LICENSE' },
  { name: 'DaisySP', file: 'DaisySP.txt', from: 'packages/core/third_party/daisysp/LICENSE' },
  {
    name: 'miniaudio',
    file: 'miniaudio.txt',
    header: {
      file: 'apps/desktop/third_party/miniaudio/miniaudio.h',
      marker: 'This software is available as a choice of the following licenses.',
    },
  },
  // FetchContent build trees — desktop and plugin fetch the same pins, so take
  // whichever tree has been configured.
  {
    name: 'webview',
    file: 'webview.txt',
    from: [
      'apps/desktop/build/_deps/webview-src/LICENSE',
      'packages/vst3/build/_deps/webview-src/LICENSE',
    ],
  },
  {
    name: 'nlohmann/json',
    file: 'nlohmann-json.txt',
    from: [
      'apps/desktop/build/_deps/nlohmann_json-src/LICENSE.MIT',
      'packages/vst3/build/_deps/nlohmann_json-src/LICENSE.MIT',
    ],
  },
  {
    name: 'portable-file-dialogs',
    file: 'portable-file-dialogs.txt',
    from: [
      'apps/desktop/build/_deps/portable_file_dialogs-src/COPYING',
      'packages/vst3/build/_deps/portable_file_dialogs-src/COPYING',
    ],
  },
  {
    name: 'iPlug2',
    file: 'iPlug2.txt',
    from: 'packages/vst3/build/_deps/iplug2-src/LICENSE.txt',
  },
  {
    name: 'iPlug2 WebView extras',
    file: 'iPlug2-WebView.txt',
    from: 'packages/vst3/build/_deps/iplug2-src/IPlug/Extras/WebView/LICENSE.txt',
  },
]

const first = (candidates) =>
  [candidates]
    .flat()
    .map((p) => join(root, p))
    .find((p) => existsSync(p))

function render(source) {
  if (source.header) {
    const file = first(source.header.file)
    return file ? fromHeader(file, source.header.marker) : null
  }
  const file = first(source.from)
  if (!file) return null
  let body = readFileSync(file, 'utf8')
  if (source.prepend) {
    const note = first(source.prepend)
    if (note) body = `${readFileSync(note, 'utf8').trimEnd()}\n\n${'='.repeat(79)}\n\n${body}`
  }
  return body.trimEnd() + '\n'
}

// ── npm production dependencies ──────────────────────────────────────────
// The web bundle ships inside the desktop app and the plugin editor, so its
// runtime dependencies are redistributed in every binary and their notices
// travel too. Collected from `pnpm licenses list --prod` and the license file
// each package actually publishes — never from the SPDX string alone.
const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'license',
  'license.md',
  'license.txt',
  'LICENSE.MIT',
  'LICENSE-MIT',
  'COPYING',
]

function npmLicenses() {
  let raw
  try {
    raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null // no install yet — skip rather than fail --check
  }
  const byLicense = JSON.parse(raw)
  const packages = []
  for (const [spdx, entries] of Object.entries(byLicense)) {
    for (const entry of entries) packages.push({ ...entry, spdx })
  }
  packages.sort((a, b) => a.name.localeCompare(b.name))

  const parts = [
    'Third-party npm packages redistributed in the OpenAxe web bundle',
    '(and therefore inside the desktop app and the plugin editor).',
    '',
    'Generated by scripts/sync-licenses.mjs from `pnpm licenses list --prod`.',
    '',
    '='.repeat(79),
    'SUMMARY',
    '='.repeat(79),
    '',
  ]
  for (const pkg of packages) {
    parts.push(`${pkg.name}@${pkg.versions.join(', ')} — ${pkg.spdx}`)
  }
  parts.push('', '='.repeat(79), 'FULL TEXTS', '='.repeat(79), '')

  for (const pkg of packages) {
    const dir = pkg.paths.find((d) => existsSync(d))
    let body = null
    if (dir) {
      for (const name of LICENSE_FILENAMES) {
        const candidate = join(dir, name)
        if (existsSync(candidate)) {
          body = readFileSync(candidate, 'utf8').trimEnd()
          break
        }
      }
    }
    parts.push('-'.repeat(79), `${pkg.name}@${pkg.versions.join(', ')} (${pkg.spdx})`)
    if (pkg.homepage) parts.push(pkg.homepage)
    parts.push('-'.repeat(79), '')
    parts.push(
      body ??
        `No license file is published in this package. Declared license: ${pkg.spdx}.\nSee ${pkg.homepage || 'the upstream project'} for the full text.`,
    )
    parts.push('')
  }
  return parts.join('\n').trimEnd() + '\n'
}

const check = process.argv.includes('--check')
mkdirSync(out, { recursive: true })

let drifted = 0
let skipped = 0
let written = 0

for (const source of SOURCES) {
  const body = render(source)
  const target = join(out, source.file)
  if (body === null) {
    skipped++
    console.log(`  skip  ${source.file} — source not checked out/built`)
    continue
  }
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (current === body) continue
  if (check) {
    drifted++
    console.error(`  DRIFT ${source.file} (${source.name})`)
    continue
  }
  writeFileSync(target, body)
  written++
  console.log(`  write ${source.file}`)
}

// npm bundle notices
{
  const body = npmLicenses()
  const target = join(out, 'npm-packages.txt')
  if (body === null) {
    skipped++
    console.log('  skip  npm-packages.txt — dependencies not installed')
  } else {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current !== body) {
      if (check) {
        drifted++
        console.error('  DRIFT npm-packages.txt')
      } else {
        writeFileSync(target, body)
        written++
        console.log('  write npm-packages.txt')
      }
    }
  }
}

if (check) {
  if (drifted) {
    console.error(
      `\nlicenses/ is stale for ${drifted} dependency(ies). Run: node scripts/sync-licenses.mjs`,
    )
    process.exit(1)
  }
  console.log(
    `sync-licenses: --check passed (${SOURCES.length - skipped} verified, ${skipped} skipped)`,
  )
} else {
  console.log(`\nsync-licenses: ${written} written, ${skipped} skipped, ${SOURCES.length} total`)
}
