import { test, expect, type Page } from '@playwright/test'

/** wasm engine init + AudioWorklet registration - generous under parallel cross-browser load. */
const POWER_ON_TIMEOUT = 30000

/**
 * Powers on via the PowerGate overlay and waits for the engine to reach
 * 'ready'. Checks the "Power off" button rather than the status text: only
 * Chromium's fake-media-device flag (see playwright.config.ts) grants the
 * mic, so on Firefox/WebKit the status text is legitimately "Running ·
 * no mic" instead of "Running" - the power button's label flip is the one
 * signal that's the same in every browser. Everything in the grid sits
 * behind the PowerGate until this resolves - see PowerGate.tsx.
 */
async function powerOn(page: Page) {
  await page
    .getByRole('dialog', { name: 'Power on' })
    .getByRole('button', { name: 'Power on' })
    .click()
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible({
    timeout: POWER_ON_TIMEOUT,
  })
}

/**
 * The core flow issue #11 asks for: load app → power on → place a block →
 * save a preset → reload it. Runs against a real browser (see
 * playwright.config.ts), so it exercises the actual Web Audio engine that
 * Vitest's jsdom environment can never reach - this is deliberately the
 * only layer that does.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Start from a clean slate: the grid/presets persist to IndexedDB (see
  // src/storage/db.ts), so a prior test's saved blocks/presets would
  // otherwise still be there on the next test's first load.
  await page.evaluate(async () => {
    localStorage.clear()
    // Treat this as an established session so the first-run factory dialog
    // never appears: the offline FX starters seed and hydrate (see
    // src/factory/factorySetup.ts), which is exactly what these flows assume.
    localStorage.setItem('openaxe:factory-setup-dismissed', '1')
    const dbs = await indexedDB.databases()
    await Promise.all(
      dbs
        .filter((db): db is { name: string } => !!db.name)
        .map(
          (db) =>
            new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(db.name)
              req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined)
            }),
        ),
    )
  })
  await page.reload()
  // Dismiss the first-run walkthrough so it doesn't sit on top of everything else.
  const onboardingClose = page.getByRole('button', { name: "Let's go" })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }
})

test('gates the app behind a power-on overlay until started', async ({ page }) => {
  const gate = page.getByRole('dialog', { name: 'Power on' })
  await expect(gate).toBeVisible()
  await expect(gate.getByRole('button', { name: 'Power on' })).toBeVisible()
  // The grid stays mounted underneath (just visually covered), ready the instant the gate clears.
  await expect(page.getByText('INPUT', { exact: true })).toBeVisible()
  await expect(page.getByText('OUTPUT', { exact: true })).toBeVisible()

  await powerOn(page)
  await expect(gate).not.toBeVisible()
})

test('places a block, auto-opens the Tone3000 catalog, and powers on', async ({ page }) => {
  await powerOn(page)

  // Scene slot 1 ("Clean") is the factory default and loads a Compressor +
  // EQ (+ auto Mixer) into columns 1-3 on every fresh session (see
  // factoryScenes.ts) - column 4 is the first actually-empty cell.
  await page.getByRole('button', { name: 'Add a block at row 1, column 4' }).click()
  await page.getByRole('menuitem', { name: 'Amp', exact: true }).click()

  // A freshly placed core block never has a model loaded yet - the catalog
  // should open on its own (see openCatalogForNewBlock.ts).
  const catalog = page.getByRole('dialog', { name: 'Tone3000 catalog' })
  await expect(catalog).toBeVisible()
  await catalog.getByRole('button', { name: 'Close' }).click()
  await expect(catalog).not.toBeVisible()

  await expect(
    page.getByRole('button', { name: 'Amp block - click or Enter to edit, arrow keys to move' }),
  ).toBeVisible()
})

test('saves the current grid as a preset and reloads it', async ({ page }) => {
  const presetName = `e2e-preset-${Date.now()}`

  await powerOn(page)

  // Scene slot 1 ("Clean") is the factory default and loads a Compressor +
  // EQ (+ auto Mixer) into columns 1-3 on every fresh session (see
  // factoryScenes.ts) - column 4 is the first actually-empty cell. Reverb
  // is used (rather than Compressor) so the new block's accessible name
  // doesn't collide with the factory Compressor already on the grid.
  await page.getByRole('button', { name: 'Add a block at row 1, column 4' }).click()
  await page.getByRole('menuitem', { name: 'Reverb' }).click()
  await page.getByRole('dialog', { name: 'Tone3000 catalog' }).waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'PRESETS' }).click()
  const presetDialog = page.getByRole('dialog', { name: 'PRESETS' })
  await expect(presetDialog).toBeVisible()
  await presetDialog.getByPlaceholder('Preset name').fill(presetName)
  await presetDialog.getByRole('button', { name: 'Save Current', exact: true }).click()
  await expect(presetDialog.getByText(presetName)).toBeVisible()
  await presetDialog.getByRole('button', { name: 'Close' }).click()

  // Reload to a clean grid, then bring the saved preset back.
  await page.reload()
  const onboardingClose = page.getByRole('button', { name: "Let's go" })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }
  await powerOn(page)

  await page.getByRole('button', { name: 'PRESETS' }).click()
  const reopenedDialog = page.getByRole('dialog', { name: 'PRESETS' })
  await expect(reopenedDialog.getByText(presetName)).toBeVisible()
  await reopenedDialog.getByRole('button', { name: `Load ${presetName}` }).click()

  // Reverb is now backed by packages/core compiled to WASM (see
  // DragonflyReverb.ts) - restoring it from a preset re-fetches and
  // re-instantiates that WASM module, same "generous under parallel
  // cross-browser CI load" category as POWER_ON_TIMEOUT above, so it needs
  // the same headroom rather than Playwright's 5s default.
  await expect(
    page.getByRole('button', {
      name: 'Reverb block - click or Enter to edit, arrow keys to move',
    }),
  ).toBeVisible({ timeout: POWER_ON_TIMEOUT })
})

// No fixture .nam/IR files ship in this repo (third-party assets aren't ours
// to redistribute - see .gitignore), and Tone3000 browsing needs a real
// OAuth connection this suite can't automate, so "hear sound" in the
// original ask is covered as far as "reaches a running, block-populated
// engine" rather than actual audio-output assertions.
