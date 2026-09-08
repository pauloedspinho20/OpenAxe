// Guard against a CMake build dir configured by a *different* environment.
//
// The repo's build trees (packages/core/build, apps/desktop/build,
// packages/vst3/build) are gitignored scratch dirs shared by every way of
// configuring them: local dev on macOS, the Linux Docker runner (which sees
// the same tree mounted at /work), and CI. A CMakeCache.txt written by one
// environment hard-codes its absolute source/binary dirs, so the next
// configure from another environment fails with "The current CMakeCache.txt
// directory ... is different". Invoke cleanStaleCmakeCache() before every
// configure: a cache that points elsewhere gets dropped (CMakeCache.txt +
// CMakeFiles), a valid cache is left alone so incremental rebuilds stay fast.
//
// Usage:
//   import { cleanStaleCmakeCache } from '../../../scripts/cmake-cache.mjs'
//   cleanStaleCmakeCache(sourceDir, buildDir)
// CLI: node scripts/cmake-cache.mjs <sourceDir> <buildDir>
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Read the absolute dirs a CMakeCache.txt was configured for. */
function cachedDirs(cacheFile) {
  let buildDir = ''
  let sourceDir = ''
  for (const line of readFileSync(cacheFile, 'utf8').split('\n')) {
    // Entry type varies by CMake version (:STATIC=, :INTERNAL=, ...).
    const cacheDir = line.match(/^CMAKE_CACHEFILE_DIR:[A-Z]+=/)
    if (cacheDir) {
      buildDir = line.slice(cacheDir[0].length).trim()
      continue
    }
    const homeDir = line.match(/^CMAKE_HOME_DIRECTORY:[A-Z]+=/)
    if (homeDir) sourceDir = line.slice(homeDir[0].length).trim()
  }
  return { buildDir, sourceDir }
}

function wipeCache(buildDir) {
  rmSync(join(buildDir, 'CMakeCache.txt'), { force: true })
  rmSync(join(buildDir, 'CMakeFiles'), { recursive: true, force: true })
}

// Full-tree wipe for an environment switch: every generated file embeds
// absolute paths (top-level cache, FetchContent *-subbuild caches, and even
// third-level caches like JUCE's juceaide tools dir), so chasing cache files
// level by level is whack-a-mole. Fetched dependency sources (*-src) are
// kept — FetchContent re-validates them with a cheap `git fetch` instead of
// a full re-clone.
function wipeBuildTree(buildDir) {
  for (const entry of readdirSync(buildDir)) {
    const full = join(buildDir, entry)
    if (entry === '_deps') {
      for (const dep of readdirSync(full)) {
        if (dep.endsWith('-src')) continue
        rmSync(join(full, dep), { recursive: true, force: true })
      }
      continue
    }
    rmSync(full, { recursive: true, force: true })
  }
}

/** Every CMakeCache.txt under a build tree (top level, FetchContent
 * subbuilds, and deeper nests like JUCE's juceaide tools dir). */
function findCaches(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('-src')) continue // fetched sources, not build output
    const full = join(dir, entry.name)
    if (entry.isDirectory()) findCaches(full, out)
    else if (entry.name === 'CMakeCache.txt') out.push(full)
  }
  return out
}

/** Remove a stale CMake cache; returns true when a wipe happened. */
export function cleanStaleCmakeCache(sourceDir, buildDir) {
  if (!existsSync(buildDir)) return false
  // Any cache in the tree whose recorded dirs don't resolve to the live
  // filesystem means the tree (or part of it) was configured by another
  // environment — absolute paths from the other side simply don't exist
  // here (/work vs /Users/...), which catches every nesting level.
  let staleReason = ''
  for (const cacheFile of findCaches(buildDir)) {
    const { buildDir: cachedBuildDir, sourceDir: cachedSourceDir } = cachedDirs(cacheFile)
    const dir = dirname(cacheFile)
    if (
      (cachedBuildDir &&
        (resolve(cachedBuildDir) !== resolve(dir) || !existsSync(cachedBuildDir))) ||
      (cachedSourceDir && !existsSync(cachedSourceDir))
    ) {
      staleReason = cachedBuildDir || cachedSourceDir
      break
    }
  }
  if (staleReason) {
    console.log(`  cmake cache points at ${staleReason} — clearing ${buildDir}`)
    wipeBuildTree(buildDir)
    return true
  }
  const cacheFile = join(buildDir, 'CMakeCache.txt')
  if (!existsSync(cacheFile)) {
    // No top-level cache, so no incremental build is possible: leftovers are
    // from an interrupted switch — clear them rather than tripping over them.
    if (readdirSync(buildDir).length > 0) {
      console.log(`  cmake cache missing with leftovers present — clearing ${buildDir}`)
      wipeBuildTree(buildDir)
      return true
    }
    return false
  }
  const { buildDir: cachedBuildDir, sourceDir: cachedSourceDir } = cachedDirs(cacheFile)
  if (
    (cachedBuildDir && resolve(cachedBuildDir) !== resolve(buildDir)) ||
    (cachedSourceDir && resolve(cachedSourceDir) !== resolve(sourceDir))
  ) {
    console.log(
      `  cmake cache points at ${cachedBuildDir || cachedSourceDir} — clearing ${buildDir}`,
    )
    wipeBuildTree(buildDir)
    return true
  }
  return false
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , sourceDir, buildDir] = process.argv
  if (!sourceDir || !buildDir) {
    console.error('usage: node scripts/cmake-cache.mjs <sourceDir> <buildDir>')
    process.exit(2)
  }
  cleanStaleCmakeCache(resolve(sourceDir), resolve(buildDir))
}
