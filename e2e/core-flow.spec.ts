import { test, expect } from '@playwright/test'

/** wasm engine init + AudioWorklet registration - generous under parallel cross-browser load. */
const POWER_ON_TIMEOUT = 30000

/**
 * Waits for the engine to reach 'ready'. Checks the "Power off" button
 * rather than the status text: only Chromium's fake-media-device flag (see
 * playwright.config.ts) grants the mic, so on Firefox/WebKit the status
 * text is legitimately "Running · no mic" instead of "Running" - the power
 * button's label flip is the one signal that's the same in every browser.
 */
async function waitForRunning(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible({
    timeout: POWER_ON_TIMEOUT,
  })
}

/**
 * The core flow issue #11 asks for: load app → place a block → power on →
 * save a preset → reload it. Runs against a real browser (see
 * playwright.config.ts), so it exercises the actual Web Audio engine that
 * Vitest's jsdom environment can never reach - this is deliberately the
 * only layer that does.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Dismiss the first-run walkthrough so it doesn't sit on top of everything else.
  const onboardingClose = page.getByRole('button', { name: 'Close walkthrough' })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }
})

test('loads the app shell with the routing grid', async ({ page }) => {
  await expect(page.getByText('NAM WEB STUDIO')).toBeVisible()
  await expect(page.getByText('IN', { exact: true })).toBeVisible()
  await expect(page.getByText('OUT', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Power on' })).toBeVisible()
})

test('places a block, auto-opens the Tone3000 catalog, and powers on', async ({ page }) => {
  await page.getByRole('button', { name: 'Add a block at row 1, column 1' }).click()
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

  await page.getByRole('button', { name: 'Power on' }).click()
  await waitForRunning(page)
})

test('saves the current grid as a preset and reloads it', async ({ page }) => {
  const presetName = `e2e-preset-${Date.now()}`

  await page.getByRole('button', { name: 'Add a block at row 1, column 1' }).click()
  await page.getByRole('menuitem', { name: 'Compressor' }).click()
  await page.getByRole('dialog', { name: 'Tone3000 catalog' }).waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'Power on' }).click()
  await waitForRunning(page)

  await page.getByRole('button', { name: 'Presets' }).click()
  const presetDialog = page.getByRole('dialog', { name: 'Preset manager' })
  await expect(presetDialog).toBeVisible()
  await presetDialog.getByPlaceholder('Preset name').fill(presetName)
  await presetDialog.getByRole('button', { name: 'Save Current' }).click()
  await expect(presetDialog.getByText(presetName)).toBeVisible()
  await presetDialog.getByRole('button', { name: 'Close' }).click()

  // Reload to a clean grid, then bring the saved preset back.
  await page.reload()
  const onboardingClose = page.getByRole('button', { name: 'Close walkthrough' })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }
  await page.getByRole('button', { name: 'Power on' }).click()
  await waitForRunning(page)

  await page.getByRole('button', { name: 'Presets' }).click()
  const reopenedDialog = page.getByRole('dialog', { name: 'Preset manager' })
  await expect(reopenedDialog.getByText(presetName)).toBeVisible()
  await reopenedDialog.getByRole('button', { name: `Load ${presetName}` }).click()

  await expect(
    page.getByRole('button', {
      name: 'Compressor block - click or Enter to edit, arrow keys to move',
    }),
  ).toBeVisible()
})

// No fixture .nam/IR files ship in this repo (third-party assets aren't ours
// to redistribute - see .gitignore), and Tone3000 browsing needs a real
// OAuth connection this suite can't automate, so "hear sound" in the
// original ask is covered as far as "reaches a running, block-populated
// engine" rather than actual audio-output assertions.
