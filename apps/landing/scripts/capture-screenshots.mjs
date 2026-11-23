#!/usr/bin/env node
/**
 * Captures high-DPI screenshots of apps/web in both Carbon (dark) and
 * Aluminum (light) hardware finishes, plus generates the 1200x630 og-image.png.
 *
 * Uses Playwright from apps/web and runs apps/web's Vite dev server locally.
 *
 *   node scripts/capture-screenshots.mjs                      # everything
 *   node scripts/capture-screenshots.mjs --only=learn,visuals # just those shots
 *
 * Shot names for --only: hero, workflow-grid, workflow-presets, workflow-tuner,
 * workflow-midi, og, learn, visuals.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const landingDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(landingDir, '../..')
const outDir = path.resolve(landingDir, 'public/screenshots')
const ogOutPath = path.resolve(landingDir, 'public/og-image.png')
const iconPath = path.resolve(landingDir, 'public/icons/openaxe-192.png')
const pkgPath = path.resolve(landingDir, 'package.json')

const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='))
  return arg ? new Set(arg.slice('--only='.length).split(',').filter(Boolean)) : null
})()
const want = (name) => !ONLY || ONLY.has(name)
const RIG_SHOTS = ['hero', 'workflow-grid', 'workflow-presets', 'workflow-tuner', 'workflow-midi']

// A short demo song for the LEARN tab workspace: sections, chords and a riff.
const DEMO_SONG_ATEX = [
  '\\title "Midnight Drive"',
  '\\artist "OpenAxe Demo"',
  '\\tempo 96',
  '.',
  '\\track "Lead Guitar"',
  '\\staff {score tabs}',
  '\\tuning (E4 B3 G3 D3 A2 E2)',
  '\\section "Intro" (0.6 2.5 2.4).4 {ch "Em"} 0.6.8 2.5.8 (3.6 2.5 0.4).4 {ch "G"} 3.6.8 5.5.8 |',
  '(2.5 2.4 2.3).4 {ch "D"} 0.4.8 2.3.8 (0.5 2.4 2.3).4 {ch "A"} 2.3.8 0.2.8 |',
  '\\section "Verse" 0.6.8 0.6.8 3.6.8 0.6.8 5.6.8 3.6.8 0.6.8 5.5.8 |',
  '7.5.8 5.5.8 7.5.8 5.5.8 (5.4 7.5).4 {ch "C5"} r.4 |',
  '0.6.8 0.6.8 3.6.8 0.6.8 5.6.8 3.6.8 7.5.16 5.5.16 3.5.8 |',
  '(2.5 2.4).2 {ch "E5"} (5.5 5.4).2 {ch "D5"} |',
  '\\section "Chorus" (3.6 2.5 0.4 0.3).2 {ch "G"} (2.5 2.4 2.3 0.2).2 {ch "D"} |',
  '(0.6 2.5 2.4 0.3).2 {ch "Em"} (3.5 2.4 0.3 1.2).2 {ch "C"} |',
  '12.2.8 15.2.8 12.1.4 14.2.8 12.2.8 14.3.4 |',
  '12.3.4 14.3.8 12.3.8 (14.4 14.3).2 {ch "E5"} |',
].join('\n')

const WEB_PORT = 5179
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`
const VIEWPORT = { width: 1440, height: 900 }

async function loadPlaywright() {
  const pwEntry = path.resolve(repoRoot, 'apps/web/node_modules/playwright/index.mjs')
  const mod = await import(pathToFileURL(pwEntry).href)
  return mod.chromium
}

async function waitForServer(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`)
}

async function startWebServer() {
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@openaxe/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  )

  let logs = ''
  child.stdout?.on('data', (chunk) => {
    logs += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    logs += chunk.toString()
  })

  try {
    await waitForServer(WEB_URL)
  } catch (err) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    throw new Error(`${err.message}\n${logs}`)
  }

  return () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
  }
}

async function encodePngToWebp(helperPage, pngBuffer, quality = 0.91) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
  const webpDataUrl = await helperPage.evaluate(
    async ({ src, q }) => {
      const img = new Image()
      img.src = src
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Failed to obtain 2D canvas context')
      ctx.drawImage(img, 0, 0)
      return canvas.toDataURL('image/webp', q)
    },
    { src: dataUrl, q: quality },
  )
  const base64 = webpDataUrl.replace(/^data:image\/webp;base64,/, '')
  return Buffer.from(base64, 'base64')
}

async function setFinish(page, finish) {
  const targetChecked = finish === 'light'
  const toggle = page.getByRole('switch', { name: 'Theme' })
  const current = (await toggle.getAttribute('aria-checked')) === 'true'
  if (current !== targetChecked) {
    await toggle.click()
  }
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.theme === expected,
    finish,
  )
  await page.waitForTimeout(220)
}

async function addBlockAt(page, row, col, menuName) {
  await page
    .getByRole('button', { name: `Add a block at row ${row}, column ${col}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: menuName, exact: true }).click()
  // Amp/Cab auto-open Tone3000 catalog when newly placed
  const catalog = page.getByRole('dialog', { name: 'Tone3000 catalog' })
  if (await catalog.isVisible().catch(() => false)) {
    await catalog.getByRole('button', { name: 'Close', exact: true }).click()
    await catalog.waitFor({ state: 'hidden' })
  }
}

async function waitForMiniTunerSignal(page) {
  await page
    .waitForFunction(
      () => {
        const btn = document.querySelector('button[aria-label="Open tuner"]')
        return btn && /\d+\.\d+\s*Hz/.test(btn.textContent || '')
      },
      undefined,
      { timeout: 1500 },
    )
    .catch(() => {})
}

async function captureBothFinishes(page, helperPage, baseName, settleMs = 180) {
  for (const finish of ['dark', 'light']) {
    await setFinish(page, finish)
    await waitForMiniTunerSignal(page)
    await page.waitForTimeout(settleMs)
    const png = await page.screenshot({ type: 'png' })
    const webp = await encodePngToWebp(helperPage, png, 0.91)
    const target = path.join(outDir, `${baseName}-${finish}.webp`)
    await writeFile(target, webp)
    console.log(
      `[capture] wrote ${path.relative(repoRoot, target)} (${(webp.length / 1024).toFixed(1)} KB)`,
    )
  }
}

async function captureModalBothFinishes(
  page,
  helperPage,
  baseName,
  openFn,
  closeFn,
  settleMs = 240,
) {
  for (const finish of ['dark', 'light']) {
    await setFinish(page, finish)
    await openFn()
    await page.waitForTimeout(settleMs)
    const png = await page.screenshot({ type: 'png' })
    const webp = await encodePngToWebp(helperPage, png, 0.91)
    const target = path.join(outDir, `${baseName}-${finish}.webp`)
    await writeFile(target, webp)
    console.log(
      `[capture] wrote ${path.relative(repoRoot, target)} (${(webp.length / 1024).toFixed(1)} KB)`,
    )
    await closeFn()
  }
}

async function buildOgImage(browser, version) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  try {
    const iconBytes = await readFile(iconPath)
    const iconDataUrl = `data:image/png;base64,${iconBytes.toString('base64')}`
    const heroWebpBytes = await readFile(path.join(outDir, 'hero-rig-dark.webp'))
    const heroDataUrl = `data:image/webp;base64,${heroWebpBytes.toString('base64')}`

    await page.setContent(
      `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body {
              width: 1200px;
              height: 630px;
              overflow: hidden;
              background: #101010;
              color: #eeece6;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              -webkit-font-smoothing: antialiased;
            }
            .canvas {
              position: relative;
              width: 1200px;
              height: 630px;
              padding: 48px 52px;
              display: grid;
              grid-template-columns: 490px 1fr;
              gap: 36px;
              align-items: center;
              background:
                radial-gradient(640px 440px at 82% 45%, rgba(255, 90, 31, 0.14), transparent 70%),
                linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                #101010;
              background-size: 100% 100%, 40px 40px, 40px 40px, 100% 100%;
            }
            .brand {
              display: flex;
              align-items: center;
              gap: 14px;
              margin-bottom: 26px;
            }
            .brand img {
              width: 44px;
              height: 44px;
              border-radius: 8px;
              border: 1px solid rgba(255,255,255,0.12);
            }
            .wordmark {
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-weight: 800;
              font-size: 20px;
              letter-spacing: 0.14em;
            }
            .wordmark span { color: #ff3b30; }
            .badge {
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 0.08em;
              padding: 4px 10px;
              border-radius: 999px;
              color: #ff5a1f;
              background: rgba(255, 90, 31, 0.16);
              border: 1px solid #ff5a1f;
            }
            .eyebrow {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-size: 12px;
              letter-spacing: 0.12em;
              text-transform: uppercase;
              color: #5fdc7a;
              margin-bottom: 14px;
            }
            .led {
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: #5fdc7a;
              box-shadow: 0 0 8px rgba(95, 220, 122, 0.7);
            }
            h1 {
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-size: 40px;
              line-height: 1.08;
              letter-spacing: -0.02em;
              font-weight: 800;
              margin-bottom: 16px;
            }
            h1 em {
              font-style: normal;
              color: #ff5a1f;
            }
            .lead {
              font-size: 18px;
              line-height: 1.45;
              color: #8f8d86;
              margin-bottom: 26px;
            }
            .specs {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
            }
            .spec {
              background: #1a1a1a;
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 6px;
              padding: 8px 12px;
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-size: 12px;
              color: #eeece6;
            }
            .spec b { color: #ff5a1f; }
            .frame {
              background: #1a1a1a;
              border: 1px solid rgba(255, 255, 255, 0.14);
              border-radius: 10px;
              overflow: hidden;
              box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 1px 0 rgba(255,255,255,0.08) inset;
            }
            .frame-bar {
              height: 30px;
              background: #212121;
              border-bottom: 1px solid rgba(255, 255, 255, 0.08);
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 0 14px;
              font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
              font-size: 10px;
              letter-spacing: 0.08em;
              color: #8f8d86;
              text-transform: uppercase;
            }
            .frame-bar .status {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              color: #5fdc7a;
            }
            .frame img {
              display: block;
              width: 100%;
              height: auto;
            }
          </style>
        </head>
        <body>
          <div class="canvas">
            <div>
              <div class="brand">
                <img src="${iconDataUrl}" alt="" />
                <div class="wordmark">OPEN<span>AXE</span></div>
                <div class="badge">v${version} BETA</div>
              </div>
              <div class="eyebrow"><span class="led"></span> Carbon · C++20 DSP · GPLv3</div>
              <h1>One modular rig. <em>Everywhere</em> you play.</h1>
              <p class="lead">
                Neural Amp Modeler captures, zero-latency cab IRs &amp; 10 studio effects on a 4×10 grid.
              </p>
              <div class="specs">
                <div class="spec"><b>WEB</b> AudioWorklet</div>
                <div class="spec"><b>DESKTOP</b> macOS · Win · Linux</div>
                <div class="spec"><b>DAW</b> VST3 · CLAP · AU</div>
              </div>
            </div>
            <div class="frame">
              <div class="frame-bar">
                <span class="status"><span class="led"></span> CHASSIS · CARBON</span>
                <span>4×10 GRAPHRIG · 48 kHz</span>
              </div>
              <img src="${heroDataUrl}" alt="" />
            </div>
          </div>
        </body>
      </html>`,
      { waitUntil: 'load' },
    )
    await page.screenshot({ path: ogOutPath, type: 'png' })
    console.log(`[capture] wrote ${path.relative(repoRoot, ogOutPath)} (1200x630)`)
  } finally {
    await page.close()
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const chromium = await loadPlaywright()
  const stopServer = await startWebServer()
  let browser

  try {
    browser = await chromium.launch({
      headless: process.env.CAPTURE_HEADED !== '1',
      args: [
        // VISUALS scenes are heavy GPU ray-marchers: use the real GPU, not
        // headless Chromium's software (SwiftShader) adapter, which drops
        // the device on them. CAPTURE_HEADED=1 runs a visible window instead.
        '--enable-unsafe-webgpu',
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--use-angle=metal',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      permissions: ['midi', 'microphone'],
    })

    const helperPage = await context.newPage()
    await helperPage.setContent('<!doctype html><body></body>')

    const page = await context.newPage()

    // Provide a virtual MIDI controller so headless Chromium displays the real
    // connected MIDI Learn mapping UI rather than a headless permission error.
    await page.addInitScript(() => {
      const fakeInput = {
        id: 'mc6-pro-1',
        name: 'Morningstar MC6 Pro',
        manufacturer: 'Morningstar Engineering',
        type: 'input',
        state: 'connected',
        connection: 'open',
        onmidimessage: null,
      }
      const fakeAccess = {
        inputs: new Map([[fakeInput.id, fakeInput]]),
        outputs: new Map(),
        onstatechange: null,
        sysexEnabled: false,
      }
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: async () => fakeAccess,
      })
    })

    // Prevent external release check banner ("New version available") during capture
    await page.route('**/releases-data.json', (route) => route.abort())

    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => {
      localStorage.clear()
      localStorage.setItem('openaxe:factory-setup-dismissed', '1')
      const dbs = await indexedDB.databases()
      await Promise.all(
        dbs
          .filter((db) => !!db.name)
          .map(
            (db) =>
              new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name)
                req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined)
              }),
          ),
      )
    })
    await page.reload({ waitUntil: 'networkidle' })

    // Dismiss onboarding if present
    const onboardingClose = page.getByRole('button', { name: "Let's go" })
    if (await onboardingClose.isVisible().catch(() => false)) {
      await onboardingClose.click()
    }

    // Power on via PowerGate
    await page
      .getByRole('dialog', { name: 'Power on' })
      .getByRole('button', { name: 'Power on' })
      .click()
    await page
      .getByRole('button', { name: 'Power off' })
      .waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(350)

    // Start built-in DI guitar sample audition so meters & tuner show live signal
    await page.getByRole('button', { name: 'INPUT', exact: true }).click()
    const inputDialog = page.getByRole('dialog', { name: 'Input' })
    await inputDialog.waitFor({ state: 'visible' })
    // The DI picker is the design-system Select (a combobox + listbox), not a <select>.
    await inputDialog.getByLabel('DI Sample').click()
    await page.getByRole('option', { name: /Neck Pickup Solo/ }).click()
    await inputDialog.getByRole('button', { name: 'Play', exact: true }).click()
    await page.waitForTimeout(300)
    await inputDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await inputDialog.waitFor({ state: 'hidden' })

    if (RIG_SHOTS.some(want) || want('og')) await captureRigShots(page, helperPage)
    if (want('og')) await buildOgImage(browser, pkg.version)
    if (want('learn')) await captureLearn(page, helperPage)
    if (want('visuals')) await captureVisuals(page, helperPage)
  } finally {
    if (browser) await browser.close()
    stopServer()
  }
}

/** The RIG view shots (hero + the four workflow tabs). */
async function captureRigShots(page, helperPage) {
  // Enrich Clean (row 1: Comp col 1, EQ col 2, Mixer col 3) into a realistic studio rig:
  // Row 1: Comp (1,1) -> EQ (1,2) -> Mixer (1,3) -> Delay (1,5) -> Reverb (1,7)
  // Row 2: Gate (2,1) -> Pedal (2,2) -> Amp (2,4) -> Cab (2,5) -> Chorus (2,6)
  await addBlockAt(page, 1, 5, 'Delay')
  await addBlockAt(page, 1, 7, 'Reverb')
  await addBlockAt(page, 2, 1, 'Gate')
  await addBlockAt(page, 2, 2, 'Pedal')
  await addBlockAt(page, 2, 4, 'Amp')
  await addBlockAt(page, 2, 5, 'Cab')
  await addBlockAt(page, 2, 6, 'Chorus')

  // Click Delay block so the BlockInspector is rich with knobs and model selectors
  await page
    .getByRole('button', { name: 'Delay block - click or Enter to edit, arrow keys to move' })
    .click()
  await page.waitForTimeout(250)

  // 1. Hero captures (full studio rig + Delay inspector + live meters)
  if (want('hero') || want('og')) await captureBothFinishes(page, helperPage, 'hero-rig', 250)

  // 2. Workflow Tab 1: Modular 4x10 parallel routing — switch to Lead or select Rotary/EQ on 2 rows
  await addBlockAt(page, 3, 3, 'Rotary')
  await addBlockAt(page, 3, 5, 'Phaser')
  await page
    .getByRole('button', { name: 'Reverb block - click or Enter to edit, arrow keys to move' })
    .click()
  await page.waitForTimeout(250)
  if (want('workflow-grid')) await captureBothFinishes(page, helperPage, 'workflow-grid', 250)

  // 3. Workflow Tab 2: Presets & 8-Slot Scenes — save custom preset first, then capture PresetManager in both finishes
  await setFinish(page, 'dark')
  await page.getByRole('button', { name: 'PRESETS', exact: true }).click()
  const presetDialog = page.getByRole('dialog', { name: 'PRESETS' })
  await presetDialog.waitFor({ state: 'visible' })
  await presetDialog.getByPlaceholder('Preset name').fill('Studio Twin Parallel')
  await presetDialog.getByRole('button', { name: 'Save Current', exact: true }).click()
  await presetDialog.getByText('Studio Twin Parallel').waitFor({ state: 'visible' })
  await presetDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await presetDialog.waitFor({ state: 'hidden' })
  // Let the save toast auto-dismiss so dialog captures remain clean
  await page.waitForTimeout(4500)

  if (want('workflow-presets'))
    await captureModalBothFinishes(
      page,
      helperPage,
      'workflow-presets',
      async () => {
        await page.getByRole('button', { name: 'PRESETS', exact: true }).click()
        await presetDialog.waitFor({ state: 'visible' })
      },
      async () => {
        await presetDialog.getByRole('button', { name: 'Close', exact: true }).click()
        await presetDialog.waitFor({ state: 'hidden' })
      },
      200,
    )

  // 4. Workflow Tab 3: Chromatic Tuner (live DI signal feeding pitch detection)
  const tunerDialog = page.getByRole('dialog', { name: 'Tuner' })
  if (want('workflow-tuner'))
    await captureModalBothFinishes(
      page,
      helperPage,
      'workflow-tuner',
      async () => {
        await page.getByRole('button', { name: 'Open tuner', exact: true }).click()
        await tunerDialog.waitFor({ state: 'visible' })
        await page
          .waitForFunction(
            () => {
              const dlg = document.querySelector('[role="dialog"][aria-label="Tuner"]')
              return dlg && /\d+\.\d+\s*Hz/.test(dlg.textContent || '')
            },
            undefined,
            { timeout: 2500 },
          )
          .catch(() => {})
      },
      async () => {
        await tunerDialog.getByRole('button', { name: 'Close', exact: true }).click()
        await tunerDialog.waitFor({ state: 'hidden' })
      },
      150,
    )

  // 5. Workflow Tab 4: MIDI Learn & Parameter Mapping
  const midiDialog = page.getByRole('dialog', { name: 'MIDI CONTROL' })
  if (want('workflow-midi'))
    await captureModalBothFinishes(
      page,
      helperPage,
      'workflow-midi',
      async () => {
        await page.getByRole('button', { name: 'MIDI', exact: true }).click()
        await midiDialog.waitFor({ state: 'visible' })
        const enableBtn = midiDialog.getByRole('button', { name: 'Enable MIDI', exact: true })
        if (await enableBtn.isVisible().catch(() => false)) {
          await enableBtn.click()
          await midiDialog
            .getByText('Preset Slot Triggers')
            .waitFor({ state: 'visible', timeout: 3000 })
            .catch(() => {})
        }
      },
      async () => {
        await midiDialog.getByRole('button', { name: 'Close', exact: true }).click()
        await midiDialog.waitFor({ state: 'hidden' })
      },
      200,
    )
}

/** LEARN: the tab workspace with a demo song loaded and the DI still playing. */
async function captureLearn(page, helperPage) {
  await setFinish(page, 'dark')
  await page.getByTitle('Media Center — backing tracks and tabs').click()
  const input = page.locator('input[type="file"][accept*=".atex"]').first()
  await input.setInputFiles({
    name: 'OpenAxe Demo - Midnight Drive.atex',
    mimeType: 'text/plain',
    buffer: Buffer.from(DEMO_SONG_ATEX, 'utf8'),
  })
  const item = page.getByText('Midnight Drive').first()
  await item.waitFor({ state: 'visible', timeout: 15000 })
  await item.click()
  // alphaTab renders asynchronously into SVG parts.
  await page
    .locator('.at-surface svg, .at-surface-svg')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {})
  await page.waitForTimeout(1500)
  await captureBothFinishes(page, helperPage, 'feature-learn', 400)
}

/** VISUALS: each scene reacting to the DI sample, control panel open. */
async function captureVisuals(page, helperPage) {
  await setFinish(page, 'dark')
  await page.getByTitle('Audio-reactive visuals').click()
  const scenes = [
    ['Distilled Cube', 'feature-visuals-cube'],
    ['Holographic Cube Grid', 'feature-visuals-grid'],
    ['Digital Core', 'feature-visuals-core'],
  ]
  for (const [name, base] of scenes) {
    await page.getByRole('button', { name, exact: true }).click()
    // Scenes compile their shaders on load; the fps badge appears once running.
    // (Visible only: the Frame rate select also holds hidden "60 fps" text.)
    await page.waitForTimeout(600)
    await page
      .getByText(/^\d+ fps$/)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 90000 })
      .catch(async (err) => {
        const alert = await page
          .getByRole('alert')
          .allTextContents()
          .catch(() => [])
        throw new Error(`${name} never started rendering: ${alert.join(' | ') || err.message}`)
      })
    await page.waitForTimeout(2500)
    await captureBothFinishes(page, helperPage, base, 1200)
  }
}

main().catch((err) => {
  console.error('[capture] failed:', err)
  process.exit(1)
})
