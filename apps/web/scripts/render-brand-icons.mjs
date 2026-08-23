// Dev-only helper (not part of the build): regenerates every raster brand
// asset from packages/ui/assets/brand/openaxe-mark.svg via headless Chromium,
// so rendering matches what users actually see (issue #151).
//
//   node apps/web/scripts/render-brand-icons.mjs            # write all icons
//   node apps/web/scripts/render-brand-icons.mjs --preview  # /tmp previews only
//
// Outputs:
//   apps/web/public/favicon.svg                       (copied source mark)
//   apps/web/public/icons/openaxe-{16,32,180,192,256,512}.png
//   apps/web/public/icons/openaxe-maskable-{192,512}.png
//   apps/desktop/packaging/openaxe.iconset/* + openaxe.icns  (macOS dock/app)
//   apps/desktop/packaging/openaxe.ico                (Windows, multi-res)
//   apps/desktop/packaging/openaxe-256.png            (Linux hicolor staging)
import { chromium } from 'playwright'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const MARK = join(repoRoot, 'packages/ui/assets/brand/openaxe-mark.svg')
const PREVIEW = process.argv.includes('--preview')
const OUT = PREVIEW ? '/tmp' : join(repoRoot, 'apps/web/public')
const PACKAGING = join(repoRoot, 'apps/desktop/packaging')

const svg = readFileSync(MARK, 'utf8')
const scaled = (size) => svg.replace('<svg xmlns', `<svg width="${size}" height="${size}" xmlns`)

const browser = await chromium.launch()
const page = await browser.newPage()

async function shot(path, size, body) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html><html><body style="margin:0">${body}</body></html>`)
  await page.screenshot({ path, omitBackground: true })
  console.log(`wrote ${path}`)
}

if (PREVIEW) {
  for (const size of [16, 32, 180, 192, 256, 512]) {
    await shot(`/tmp/openaxe-${size}.png`, size, scaled(size))
  }
  await browser.close()
  process.exit(0)
}

// ── web: transparent mark PNGs ───────────────────────────────────────────
mkdirSync(join(OUT, 'icons'), { recursive: true })
for (const size of [16, 32, 180, 192, 256, 512]) {
  await shot(join(OUT, 'icons', `openaxe-${size}.png`), size, scaled(size))
}

// maskable: axe shrunk into the safe zone on a full-bleed chassis square
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.74)
  const innerSvg = svg
    .replace('viewBox="0 0 512 512"', 'viewBox="16 16 480 480"')
    .replace('<svg xmlns', `<svg width="${inner}" height="${inner}" xmlns`)
  await shot(
    join(OUT, 'icons', `openaxe-maskable-${size}.png`),
    size,
    `<div style="width:${size}px;height:${size}px;background:#141414;display:flex;align-items:center;justify-content:center">${innerSvg}</div>`,
  )
}

// favicon: the SVG itself is the primary icon; keep it in sync with the mark
copyFileSync(MARK, join(OUT, 'favicon.svg'))
console.log(`wrote ${join(OUT, 'favicon.svg')}`)

// ── desktop: macOS .icns (full size ladder) via iconutil ─────────────────
const iconset = join(PACKAGING, 'openaxe.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
const ladder = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]
for (const [name, size] of ladder) {
  await shot(join(iconset, name), size, scaled(size))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(PACKAGING, 'openaxe.icns')])
console.log(`wrote ${join(PACKAGING, 'openaxe.icns')}`)

// ── desktop: Windows .ico (PNG-compressed entries, Vista+) ────────────────
// Assembled by hand (no ImageMagick dependency): ICO container with
// PNG-encoded 16/32/48/64/128/256 entries.
const entries = [16, 32, 48, 64, 128, 256]
const pngs = new Map()
for (const size of entries) {
  const file =
    size === 16
      ? 'icon_16x16.png'
      : size === 32
        ? 'icon_32x32.png'
        : size === 64
          ? 'icon_32x32@2x.png'
          : size === 128
            ? 'icon_128x128.png'
            : size === 256
              ? 'icon_256x256.png'
              : null // 48 has no direct ladder entry - downscale the 256 via sips
  if (file) pngs.set(size, readFileSync(join(iconset, file)))
}
const tmp48 = '/tmp/openaxe-48.png'
execFileSync('sips', ['-z', '48', '48', join(iconset, 'icon_256x256.png'), '--out', tmp48], {
  stdio: 'ignore',
})
pngs.set(48, readFileSync(tmp48))

const { writeFileSync } = await import('node:fs')
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(entries.length, 4)
const dirEntrySize = 16
const dataOffset = header.length + dirEntrySize * entries.length
const dir = Buffer.alloc(dirEntrySize * entries.length)
const blobs = []
let offset = dataOffset
entries.forEach((size, i) => {
  const data = pngs.get(size)
  const entry = dir.subarray(i * dirEntrySize, (i + 1) * dirEntrySize)
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
  entry.writeUInt8(0, 2) // palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += data.length
  blobs.push(data)
})
const ico = Buffer.concat([header, dir, ...blobs])
writeFileSync(join(PACKAGING, 'openaxe.ico'), ico)
console.log(`wrote ${join(PACKAGING, 'openaxe.ico')}`)

// Linux staging: single hicolor PNG (stage.cmake installs it)
copyFileSync(join(iconset, 'icon_256x256.png'), join(PACKAGING, 'openaxe-256.png'))
console.log(`wrote ${join(PACKAGING, 'openaxe-256.png')}`)

await browser.close()
