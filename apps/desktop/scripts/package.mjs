// Packages the desktop app into a platform artifact (issue #15 M4): builds the
// web UI + native app (Release), then runs CPack to produce:
//   macOS  build/nam-studio-desktop-<v>.dmg  (.app bundle inside)
//   Windows build/nam-studio-desktop-<v>.zip
//   Linux   build/nam-studio-desktop-<v>.deb
//
//   node scripts/package.mjs

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { run } from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

run(false)  // Release + bundle the web UI into build/ui

console.log('[nam/desktop] running cpack...')
execFileSync('cpack', ['--config', join(root, 'build', 'CPackConfig.cmake')], {
  stdio: 'inherit',
})
console.log('[nam/desktop] package done (artifacts in build/).')
