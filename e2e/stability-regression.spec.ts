import { test, expect } from '@playwright/test'

/**
 * A practical stand-in for issue #11's "audio engine regression tests:
 * glitch-free model switching, CPU load under dual-chain + full FX". Real
 * audio-glitch waveform analysis and CPU-load measurement aren't feasible
 * from Playwright (no fixture .nam/IR files ship in this repo, and there's
 * no way to record/inspect the actual audio graph's output samples from
 * here) - what this *can* verify, and does, is that building a full 11-
 * block chain, toggling every bypass, and tearing blocks back down again
 * doesn't throw, doesn't leave the UI stuck, and doesn't leave a single
 * console error behind. True glitch/CPU regression testing needs either a
 * dedicated OfflineAudioContext-based Vitest suite or manual QA with real
 * model files - both are still open (see the issue).
 */
test('builds a full FX chain, toggles every bypass, and tears it down without errors', async ({
  page,
}) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto('/')
  const onboardingClose = page.getByRole('button', { name: 'Close walkthrough' })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }

  await page.getByRole('button', { name: 'Power on' }).click()
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible({ timeout: 30000 })

  const FX_KINDS = [
    'Noise Gate',
    'Compressor',
    'EQ',
    'Chorus',
    'Flanger',
    'Phaser',
    'Tremolo',
    'Delay',
    'Ping-Pong Delay',
    'Reverb',
  ]

  // One block per column across the grid's 3 rows - well within GRID_ROWS x
  // GRID_COLS, and spread across rows so the semi-auto wiring (see
  // graphStore.ts) has to splice/anchor a mix of adjacent and orphaned cells.
  for (let i = 0; i < FX_KINDS.length; i++) {
    const row = (i % 3) + 1
    const col = Math.floor(i / 3) + 1
    await page.getByRole('button', { name: `Add a block at row ${row}, column ${col}` }).click()
    await page.getByRole('menuitem', { name: FX_KINDS[i], exact: true }).click()
  }
  await page.getByRole('button', { name: 'Add a block at row 1, column 5' }).click()
  await page.getByRole('menuitem', { name: 'Mixer', exact: true }).click()

  for (const kind of FX_KINDS) {
    await page.getByRole('button', { name: `Bypass ${kind}` }).click()
  }
  for (const kind of FX_KINDS) {
    await page.getByRole('button', { name: `Enable ${kind}` }).click()
  }

  for (const kind of [...FX_KINDS, 'Mixer']) {
    await page.getByRole('button', { name: `Remove ${kind}` }).click()
  }

  await expect(page.getByRole('button', { name: /block - click or Enter to edit/ })).toHaveCount(0)
  // The engine itself should have stayed up throughout - not just the grid emptying out.
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible()

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})
