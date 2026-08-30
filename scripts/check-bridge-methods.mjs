#!/usr/bin/env node
// Verifies that every window.openAxe.* method the React app calls is actually
// exposed by both native shells (issue #300 follow-up).
//
// The two shells expose the bridge in completely different ways, and only one
// of them fails loudly when a method is missing:
//
//   - The desktop shell calls webview::bind() per method in
//     apps/desktop/src/main.cpp, so a missing bind leaves the function
//     undefined and the call rejects with a clear error.
//   - The plugin has no such API. Its webview gets a hand-written polyfill
//     (packages/vst3/src/bridge_polyfill.cpp) that walks a literal array of
//     method names and defines one stub per entry. A handler added to
//     VstBridge but not named in that array simply does not exist as far as
//     the UI is concerned - and because the app treats "no bridge method" as
//     "we must be on the web", it silently falls back to browser storage
//     instead of the shared library. That is not a crash, it is data quietly
//     going to the wrong place, which is exactly how the storage bridge was
//     nearly shipped dead.
//
// So: parse the method names out of native/openaxe.ts, and diff them against
// the polyfill array and the dispatch table.
//
// Usage:
//   node scripts/check-bridge-methods.mjs   # exit 1 on drift, no writes
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TS_BRIDGE = join(ROOT, 'apps/web/src/native/openaxe.ts')
const POLYFILL = join(ROOT, 'packages/vst3/src/bridge_polyfill.cpp')
const VST_DISPATCH = join(ROOT, 'packages/vst3/src/vst_bridge.cpp')
const DESKTOP_BINDS = join(ROOT, 'apps/desktop/src/main.cpp')

/** Every method the TS bridge actually invokes: this.call<...>('name', ...). */
function methodsCalledByTheApp() {
  const source = readFileSync(TS_BRIDGE, 'utf8')
  const names = new Set()
  for (const match of source.matchAll(/this\.call<[^>]*>\(\s*'([a-zA-Z]+)'/g)) {
    names.add(match[1])
  }
  for (const match of source.matchAll(/this\.call\(\s*'([a-zA-Z]+)'/g)) {
    names.add(match[1])
  }
  return names
}

/** The literal array the plugin's polyfill binds. */
function methodsInPolyfill() {
  const source = readFileSync(POLYFILL, 'utf8')
  const start = source.indexOf('var methods = [')
  if (start === -1) throw new Error('check-bridge-methods: no `var methods = [` in the polyfill')
  const end = source.indexOf('];', start)
  if (end === -1) throw new Error('check-bridge-methods: unterminated methods array')
  const names = new Set()
  for (const match of source.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)) names.add(match[1])
  return names
}

function namesMatching(path, pattern) {
  const source = readFileSync(path, 'utf8')
  const names = new Set()
  for (const match of source.matchAll(pattern)) names.add(match[1])
  return names
}

const called = methodsCalledByTheApp()
const polyfill = methodsInPolyfill()
const vstDispatch = namesMatching(VST_DISPATCH, /method == "openAxe\.([a-zA-Z]+)"/g)
const desktopBinds = namesMatching(DESKTOP_BINDS, /"openAxe\.([a-zA-Z]+)"/g)

/**
 * Methods a shell legitimately does not implement, with the reason. Kept
 * explicit rather than letting the check be loose: the whole point is that a
 * missing method is invisible at runtime, so "we meant to skip that one" has
 * to be written down somewhere the next person will see.
 */
const EXPECTED_ABSENT = {
  desktop: {
    setInputChannel:
      'plugin-only so far: the desktop shell opens the device itself, so ' +
      'channel selection there belongs in audio.cpp at the device layer ' +
      'rather than in the graph feed, and its Settings offers no Channel ' +
      'control yet. useNativeAudioEngine only calls this in a plugin.',
    getState:
      'plugin-only: useNativeAudioEngine calls adoptFromCore() behind ' +
      '!shellOwnsAudioDevice(), so the desktop shell never reaches it — there ' +
      'the browser store, not the core graph, is the source of truth',
  },
  plugin: {},
}

const problems = []
const report = (label, missing, hint) => {
  if (missing.length) problems.push(`  ${label}: ${missing.join(', ')}\n      ${hint}`)
}

report(
  'missing from the plugin polyfill',
  [...called].filter((m) => !polyfill.has(m) && !EXPECTED_ABSENT.plugin[m]).sort(),
  `add them to the methods array in packages/vst3/src/bridge_polyfill.cpp`,
)
report(
  'missing from the plugin dispatch',
  [...called].filter((m) => !vstDispatch.has(m) && !EXPECTED_ABSENT.plugin[m]).sort(),
  `add an else-if branch in packages/vst3/src/vst_bridge.cpp`,
)
report(
  'missing from the desktop binds',
  [...called].filter((m) => !desktopBinds.has(m) && !EXPECTED_ABSENT.desktop[m]).sort(),
  `add a Bind/BindShared call in apps/desktop/src/main.cpp`,
)
// The reverse direction is worth knowing about but is not a failure: a shell
// may expose something the current UI has no use for yet.
const unused = [...polyfill].filter((m) => !called.has(m)).sort()

// A stale exception is its own kind of drift: if the shell grew the method
// after all, the note is now misleading.
const staleDesktop = Object.keys(EXPECTED_ABSENT.desktop).filter((m) => desktopBinds.has(m))
const stalePlugin = Object.keys(EXPECTED_ABSENT.plugin).filter((m) => polyfill.has(m))
if (staleDesktop.length || stalePlugin.length) {
  problems.push(
    `  stale EXPECTED_ABSENT entries: ${[...staleDesktop, ...stalePlugin].join(', ')}\n` +
      `      the shell exposes these now — drop them from EXPECTED_ABSENT`,
  )
}

if (problems.length) {
  console.error('Bridge method drift - the UI calls methods a shell does not expose:\n')
  console.error(problems.join('\n'))
  console.error('')
  process.exit(1)
}

console.log(
  `Bridge methods in sync: ${called.size} called by the app, all present in the plugin polyfill, ` +
    `the plugin dispatch and the desktop binds.`,
)
if (unused.length) console.log(`  (exposed but currently unused: ${unused.join(', ')})`)
