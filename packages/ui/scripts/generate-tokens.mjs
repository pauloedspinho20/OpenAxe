#!/usr/bin/env node
// Generates design token artifacts from packages/ui/tokens/design-tokens.json
// (issue #131). Follows the conventions of the four scripts in scripts/:
// regenerate by default, --check to fail on drift (for CI).
//
// Usage:
//   node packages/ui/scripts/generate-tokens.mjs                  # regenerate all
//   node packages/ui/scripts/generate-tokens.mjs --check          # fail on drift, no writes
//   node packages/ui/scripts/generate-tokens.mjs --target=css     # only CSS
//   node packages/ui/scripts/generate-tokens.mjs --target=cpp --check
//

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(THIS_DIR, '../../..')
const TOKENS_JSON = join(ROOT, 'packages/ui/tokens/design-tokens.json')
const TOKENS_DIR = join(ROOT, 'packages/ui/tokens')
const CPP_OUT = join(ROOT, 'packages/vst3/generated/tokens.h')

const KNOWN_TARGETS = ['css', 'cpp']
const targetArg = process.argv.find((a) => a.startsWith('--target='))
let selectedTargets = [...KNOWN_TARGETS]
if (targetArg) {
  selectedTargets = targetArg
    .slice('--target='.length)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const t of selectedTargets) {
    if (!KNOWN_TARGETS.includes(t)) {
      console.error(`Unknown --target '${t}' (known: ${KNOWN_TARGETS.join(', ')})`)
      process.exit(1)
    }
  }
}
const CHECK_ONLY = process.argv.includes('--check')

function camelToKebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// Special cases where JSON key -> CSS var mapping is not pure camelToKebab
const SPACING_MAP = {
  sp1: 'sp-1',
  sp2: 'sp-2',
  sp3: 'sp-3',
  sp4: 'sp-4',
  sp5: 'sp-5',
  sp6: 'sp-6',
  sp7: 'sp-7',
  radiusSm: 'r-sm',
  radiusMd: 'r-md',
  radiusLg: 'r-lg',
}
function cssVarForSpacing(key) {
  if (SPACING_MAP[key]) return `--${SPACING_MAP[key]}`
  return `--${camelToKebab(key)}`
}
function cssVarForColor(key) {
  return `--${camelToKebab(key)}`
}

// Resolve rgb(... / ...%) and #hex to {r,g,b,a} for C++
function parseColor(value) {
  const v = value.trim()
  if (v.startsWith('#')) {
    let hex = v.slice(1)
    if (hex.length === 3)
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('')
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 255,
      }
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16),
      }
    }
  }
  const m = v.match(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)%\s*\)/)
  if (m) {
    const r = Math.round(Number(m[1]))
    const g = Math.round(Number(m[2]))
    const b = Math.round(Number(m[3]))
    const a = Math.round((Number(m[4]) / 100) * 255)
    return { r, g, b, a }
  }
  // fallback — treat as opaque
  return null
}
function rgbaToCss(rgba) {
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${(rgba.a / 255).toFixed(3).replace(/\.?0+$/, '')})`
}

function loadTokens() {
  const raw = readFileSync(TOKENS_JSON, 'utf8')
  return JSON.parse(raw)
}

function generateColorsCss(tokens) {
  const c = tokens.color
  const header = `/* ================================================================\n   Colors — design tokens\n   Two hardware finishes: Carbon (dark, default) and Aluminum (light)\n   Screens/LCDs stay dark glass in both finishes.\n   ================================================================ */\n\n`
  const dark = c.dark
  const light = c.light
  const shared = c.shared

  function blockVars(obj) {
    return Object.entries(obj)
      .map(([k, v]) => `  ${cssVarForColor(k)}: ${v};`)
      .join('\n')
  }

  // Keep the same grouping/comments as the hand-written file so drift is minimal.
  const darkBlock = `/* Carbon (dark) — default */\n:root,\n:root[data-theme='dark'] {\n  /* Surfaces */\n  --chassis: ${dark.chassis};\n  --panel: ${dark.panel};\n  --panel-raised: ${dark.panelRaised};\n  --panel-recessed: ${dark.panelRecessed};\n  --seam: ${dark.seam};\n  --seam-strong: ${dark.seamStrong};\n  --highlight: ${dark.highlight};\n\n  /* Text */\n  --ink-1: ${dark.ink1};\n  --ink-2: ${dark.ink2};\n  --ink-3: ${dark.ink3};\n\n  /* Text on dark backgrounds (overlays, image cards) */\n  --ink-reverse-1: ${dark.inkReverse1};\n  --ink-reverse-2: ${dark.inkReverse2};\n  --ink-reverse-3: ${dark.inkReverse3};\n\n  /* Shadows */\n  --shadow-ambient: ${dark.shadowAmbient};\n  --shadow-deep: ${dark.shadowDeep};\n  --shadow-soft: ${dark.shadowSoft};\n}\n`
  const lightBlock = `\n/* Aluminum (light) */\n:root[data-theme='light'] {\n  --chassis: ${light.chassis};\n  --panel: ${light.panel};\n  --panel-raised: ${light.panelRaised};\n  --panel-recessed: ${light.panelRecessed};\n  --seam: ${light.seam};\n  --seam-strong: ${light.seamStrong};\n  --highlight: ${light.highlight};\n\n  --ink-1: ${light.ink1};\n  --ink-2: ${light.ink2};\n  --ink-3: ${light.ink3};\n\n  --ink-reverse-1: ${light.inkReverse1};\n  --ink-reverse-2: ${light.inkReverse2};\n  --ink-reverse-3: ${light.inkReverse3};\n\n  --shadow-ambient: ${light.shadowAmbient};\n  --shadow-deep: ${light.shadowDeep};\n  --shadow-soft: ${light.shadowSoft};\n}\n`
  const sharedBlock = `\n:root {\n  /* Screens/LCDs: always dark glass, regardless of chassis finish */\n  --screen-bg: ${shared.screenBg};\n  --screen-text: ${shared.screenText};\n  --screen-dim: ${shared.screenDim};\n  --screen-white: ${shared.screenWhite};\n\n  /* Accent — signature hardware orange, used sparingly for active state only */\n  --accent: ${shared.accent};\n  --accent-dim: ${shared.accentDim};\n  --accent-ink: ${shared.accentInk};\n\n  /* Notice banner (non-critical info) */\n  --notice-surface: ${shared.noticeSurface};\n  --notice-border: ${shared.noticeBorder};\n\n  /* Danger / error */\n  --danger-surface: ${shared.dangerSurface};\n  --danger-border: ${shared.dangerBorder};\n\n  /* Status LEDs */\n  --led-on: ${shared.ledOn};\n  --led-warn: ${shared.ledWarn};\n  --led-hot: ${shared.ledHot};\n  --led-hot-bright: ${shared.ledHotBright};\n  --led-off: ${shared.ledOff};\n\n  /* Meter */\n  --meter-off: ${shared.meterOff};\n  --meter-glow-green: ${shared.meterGlowGreen};\n  --meter-glow-amber: ${shared.meterGlowAmber};\n  --meter-glow-red: ${shared.meterGlowRed};\n\n  /* Overlays / backdrops */\n  --overlay-bg: ${shared.overlayBg};\n  --overlay-bg-strong: ${shared.overlayBgStrong};\n\n  /* Panel screws */\n  --screw-light: ${shared.screwLight};\n  --screw-dark: ${shared.screwDark};\n  --screw-highlight: ${shared.screwHighlight};\n\n  /* Fader */\n  --fader-track: ${shared.faderTrack};\n  --fader-track-border: ${shared.faderTrackBorder};\n  --fader-thumb-top: ${shared.faderThumbTop};\n  --fader-thumb-bottom: ${shared.faderThumbBottom};\n\n  /* Toggle */\n  --toggle-thumb-top: ${shared.toggleThumbTop};\n  --toggle-thumb-bottom: ${shared.toggleThumbBottom};\n\n  /* Button */\n  --btn-hover-border: ${shared.btnHoverBorder};\n  --btn-active-highlight: ${shared.btnActiveHighlight};\n  --danger-bg-dim: ${shared.dangerBgDim};\n  --danger-glow-dim: ${shared.dangerGlowDim};\n\n  /* Blocks — semantic group colors (8 groups covering all 22 BlockKinds) */\n  --block-tone: ${shared.blockTone};\n  --block-drive: ${shared.blockDrive};\n  --block-dynamics: ${shared.blockDynamics};\n  --block-filter: ${shared.blockFilter};\n  --block-mod: ${shared.blockMod};\n  --block-time: ${shared.blockTime};\n  --block-space: ${shared.blockSpace};\n  --block-utility: ${shared.blockUtility};\n  --block-core: ${shared.blockCore};\n  --block-effects: ${shared.blockEffects};\n}\n`
  return header + darkBlock + lightBlock + sharedBlock
}

function generateSpacingCss(tokens) {
  const s = tokens.spacing
  const header = `/* ================================================================\n   Spacing — 4px base scale\n   ================================================================ */\n\n`
  const core = `:root {\n  --sp-1: ${s.sp1};\n  --sp-2: ${s.sp2};\n  --sp-3: ${s.sp3};\n  --sp-4: ${s.sp4};\n  --sp-5: ${s.sp5};\n  --sp-6: ${s.sp6};\n  --sp-7: ${s.sp7};\n\n  /* Radius: small, machined — not the soft rounded corners of a typical web app */\n  --r-sm: ${s.radiusSm};\n  --r-md: ${s.radiusMd};\n  --r-lg: ${s.radiusLg};\n\n  /* Component sizing */\n  --screw-size: ${s.screwSize};\n  --screw-offset: ${s.screwOffset};\n  --led-size-sm: ${s.ledSizeSm};\n\n  --toggle-width: ${s.toggleWidth};\n  --toggle-height: ${s.toggleHeight};\n  --toggle-thumb: ${s.toggleThumb};\n  --toggle-travel: ${s.toggleTravel};\n\n  --fader-track-height: ${s.faderTrackHeight};\n  --fader-track-width: ${s.faderTrackWidth};\n  --fader-thumb-w: ${s.faderThumbW};\n  --fader-thumb-h: ${s.faderThumbH};\n  --fader-thumb-offset: ${s.faderThumbOffset};\n\n  --meter-segment-w: ${s.meterSegmentW};\n  --meter-segment-h: ${s.meterSegmentH};\n\n  --input-height: ${s.inputHeight};\n\n  --jack-size: ${s.jackSize};\n  --jack-wrap-size: ${s.jackWrapSize};\n  --jack-offset: ${s.jackOffset};\n\n  --rail-min-width: ${s.railMinWidth};\n  --grid-min-row: ${s.gridMinRow};\n  --grid-min-col: ${s.gridMinCol};\n}\n`
  return header + core
}

function generateTypographyCss(tokens) {
  const t = tokens.typography
  const header = `/* ================================================================\n   Typography — font families and base text settings\n   ================================================================ */\n\n`
  const body = `:root {\n  --font-display: ${t.fontDisplay};\n  --font-body: ${t.fontBody};\n\n  font: ${t.baseSize}/${t.baseLineHeight} var(--font-body);\n  color: var(--ink-1);\n  background: var(--chassis);\n  font-synthesis: none;\n  text-rendering: optimizeLegibility;\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  transition:\n    background-color 0.15s ease,\n    color 0.15s ease;\n}\n`
  return header + body
}

function generateShadowsCss(tokens) {
  const sh = tokens.shadow
  const header = `/* ================================================================\n   Shadows / Elevation — built from theme shadow tones\n   ================================================================ */\n\n`
  const body = `:root {\n  --shadow-panel: ${sh.panel};\n  --shadow-recessed: ${sh.recessed};\n  --shadow-control: ${sh.control};\n}\n`
  return header + body
}

function generateCpp(tokens) {
  // Resolve alpha for C++: rgba ints. Header is optional — only used if a native control needs it.
  // IColor ctor is IColor(a, r, g, b) — see IGraphicsStructs.h:71.
  function cppColor(name, value) {
    const rgba = parseColor(value)
    if (!rgba) return `  // ${name}: ${value} (unparsed)`
    return `  inline constexpr IColor ${name} = IColor(${rgba.a}, ${rgba.r}, ${rgba.g}, ${rgba.b});`
  }
  // For spacing, parse px -> float
  function pxToFloat(px) {
    return parseFloat(px.replace('px', ''))
  }

  const c = tokens.color
  const s = tokens.spacing
  const t = tokens.typography

  let out = `// GENERATED FILE - do not edit by hand.\n`
  out += `// Produced by packages/ui/scripts/generate-tokens.mjs from packages/ui/tokens/design-tokens.json\n`
  out += `// Design tokens for C++ (IControl / IGraphics) — optional target. Primary target is CSS for React.\n`
  out += `#pragma once\n\n`
  out += `#include \"IPlug_include_in_plug_hdr.h\"\n\n`
  out += `namespace openaxe::tokens {\n\n`

  out += `// ── Colors ─────────────────────────────────────────────────────────\n`
  out += `namespace color {\n`
  out += `namespace dark {\n`
  for (const [k, v] of Object.entries(c.dark)) out += `${cppColor(k, v)}\n`
  out += `} // namespace dark\n`
  out += `namespace light {\n`
  for (const [k, v] of Object.entries(c.light)) out += `${cppColor(k, v)}\n`
  out += `} // namespace light\n`
  out += `namespace shared {\n`
  for (const [k, v] of Object.entries(c.shared)) out += `${cppColor(k, v)}\n`
  out += `} // namespace shared\n`
  out += `} // namespace color\n\n`

  out += `// ── Spacing / radii / sizing ──────────────────────────────────────\n`
  out += `namespace spacing {\n`
  for (const [k, v] of Object.entries(s)) {
    const cppName = k // keep camelCase for C++
    const px = parseFloat(v)
    if (!Number.isNaN(px))
      out += `  inline constexpr float ${cppName} = ${px.toFixed(1).replace(/\\.0$/, '.0')}f; // ${v}\n`
    else out += `  inline constexpr const char* ${cppName} = \"${v}\";\n`
  }
  out += `} // namespace spacing\n\n`

  out += `// ── Typography ─────────────────────────────────────────────────────\n`
  out += `namespace typography {\n`
  out += `  inline constexpr const char* kFontDisplay = \"${t.fontDisplay.replace(/\"/g, '\\\\\"')}\";\n`
  out += `  inline constexpr const char* kFontBody = \"${t.fontBody.replace(/\"/g, '\\\\\"')}\";\n`
  out += `  inline constexpr float kBaseSize = ${pxToFloat(t.baseSize).toFixed(1).replace(/\\.0$/, '.0')}f;\n`
  out += `  inline constexpr float kBaseLineHeight = ${Number(t.baseLineHeight)
    .toFixed(2)
    .replace(/\\.?0+$/, '')}f;\n`
  out += `} // namespace typography\n\n`

  out += `} // namespace openaxe::tokens\n`
  return out
}

function writeOrCheck(filePath, content) {
  if (CHECK_ONLY) {
    if (!existsSync(filePath)) {
      console.error(`generate-tokens: missing ${filePath} (run without --check to generate)`)
      return false
    }
    const existing = readFileSync(filePath, 'utf8')
    if (existing !== content) {
      console.error(`generate-tokens: drift in ${filePath}`)
      // Show diff hint: first mismatched line
      const a = existing.split('\n')
      const b = content.split('\n')
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`  line ${i + 1}: expected ${JSON.stringify(b[i])}`)
          console.error(`           got ${JSON.stringify(a[i])}`)
          break
        }
      }
      console.error(`Run \`node packages/ui/scripts/generate-tokens.mjs\` to regenerate.`)
      return false
    }
    return true
  } else {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
    return true
  }
}

const tokens = loadTokens()
let ok = true
if (selectedTargets.includes('css')) {
  ok = writeOrCheck(join(TOKENS_DIR, 'colors.css'), generateColorsCss(tokens)) && ok
  ok = writeOrCheck(join(TOKENS_DIR, 'spacing.css'), generateSpacingCss(tokens)) && ok
  ok = writeOrCheck(join(TOKENS_DIR, 'typography.css'), generateTypographyCss(tokens)) && ok
  ok = writeOrCheck(join(TOKENS_DIR, 'shadows.css'), generateShadowsCss(tokens)) && ok
  if (!CHECK_ONLY) console.log('generate-tokens: CSS regenerated from design-tokens.json')
}
if (selectedTargets.includes('cpp')) {
  const cppContent = generateCpp(tokens)
  ok = writeOrCheck(CPP_OUT, cppContent) && ok
  if (!CHECK_ONLY) console.log(`generate-tokens: C++ header written to ${CPP_OUT}`)
}

if (!ok) process.exit(1)
if (CHECK_ONLY) console.log(`generate-tokens: --check passed (${selectedTargets.join(', ')})`)
