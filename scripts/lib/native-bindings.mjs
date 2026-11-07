// Shared detection for the Rosetta-pnpm wrong-arch install failure (issue
// #387): pnpm picks a package's platform-specific optional dependencies from
// the architecture of *its own process*, not the Node that later loads them.
// A pnpm installed as the x86_64 build
// (~/Library/pnpm/.tools/@pnpm+macos-x64/...) running under Rosetta on an
// arm64 Mac therefore installs darwin-x64 binaries that arm64 Node cannot
// load, and every build then dies inside rolldown/lightningcss/oxlint with
// "Cannot find native binding" and a 60-line stack trace that says nothing
// about the real cause.
//
// Both scripts/check-native-bindings.mjs (the fail-fast postinstall check)
// and scripts/setup.mjs (the repair path) build on this module, so the list
// of families and the definition of "wrong" live in exactly one place.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Packages that ship one native binary per platform as optional dependencies.
 * pnpm installs only the ones matching its own process's platform/arch, so a
 * mismatch here is exactly the Rosetta-pnpm failure. Keys are the prefix a
 * virtual-store directory name starts with. These are the dlopen'd bindings -
 * a wrong-arch copy breaks vitest/lint/build outright. esbuild is deliberately
 * absent: its binary runs as a child process, which survives Rosetta, so a
 * wrong-arch esbuild never breaks the loop this guards.
 */
export const NATIVE_FAMILIES = [
  '@rolldown+binding-',
  '@oxlint+binding-',
  '@oxc-parser+binding-',
  '@oxc-resolver+binding-',
  'lightningcss-',
]

/** Matches the `<os>-<arch>` infix of a virtual-store binding directory. */
export const PLATFORM_TOKEN = /(darwin|linux|win32)-(x64|arm64|ia32|arm)/

/** The `<os>-<arch>` pair the running Node needs binaries for. */
export function wantedPlatform(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

/**
 * Returns the families whose installed binaries are all for the wrong
 * platform/arch (an empty array means the install is usable). Reads directory
 * names in the virtual store rather than importing anything, so it costs
 * nothing and reports every broken family at once instead of the first. A
 * family with no platform-specific directories installed at all is skipped -
 * it is simply not used on this platform.
 */
export function mismatchedNativeBindings(root) {
  const storeDir = join(root, 'node_modules/.pnpm')
  if (!existsSync(storeDir)) return []
  const entries = readdirSync(storeDir)
  const wanted = wantedPlatform()
  const broken = []
  for (const family of NATIVE_FAMILIES) {
    const installed = entries.filter((e) => e.startsWith(family) && PLATFORM_TOKEN.test(e))
    if (installed.length === 0) continue
    if (!installed.some((e) => e.includes(wanted))) {
      broken.push({ family, installed: installed.map((e) => e.replace(/@\d[\d.]*$/, '')) })
    }
  }
  return broken
}

/** The pnpm version package.json pins, for repair commands and error hints. */
export function declaredPnpmVersion(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return String(pkg.packageManager ?? 'pnpm@latest')
      .split('@')
      .pop()
  } catch {
    return 'latest'
  }
}
