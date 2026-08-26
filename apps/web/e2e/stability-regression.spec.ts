import { test, expect } from '@playwright/test'

/**
 * A practical stand-in for issue #11's "audio engine regression tests:
 * glitch-free model switching, CPU load under dual-chain + full FX". Real
 * audio-glitch waveform analysis and CPU-load measurement aren't feasible
 * from Playwright (no fixture .nam/IR files ship in this repo, and there's
 * no way to record/inspect the actual audio graph's output samples from
 * here) - what this *can* verify, and does, is that building a full 10-
 * block chain, toggling every bypass, and tearing blocks back down again
 * doesn't throw, doesn't leave the UI stuck, and doesn't leave a single
 * console error behind. True glitch/CPU regression testing needs either a
 * dedicated OfflineAudioContext-based Vitest suite or manual QA with real
 * model files - both are still open (see the issue).
 */
test('builds a full FX chain, toggles every bypass, and tears it down without errors', async ({
  page,
}) => {
  // Heaviest test in the suite: it sequentially builds 10 WASM-backed effect
  // blocks, each of which compiles/instantiates an AudioWorklet + fetches the
  // core .wasm. Under the parallel 4-worker matrix that routinely exceeds the
  // 30s default on a loaded machine (the grid reflows as blocks land, so a
  // "+" button can move mid-click), so give it a real budget. It passes in
  // ~6s in isolation; this is headroom, not a per-test norm.
  test.setTimeout(180_000)
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto('/')
  // Start from a clean slate: the grid/presets persist to IndexedDB (see
  // src/storage/db.ts), so a prior test run's saved blocks/presets would
  // otherwise still be there on this load.
  await page.evaluate(async () => {
    localStorage.clear()
    // Established-session marker: keeps the first-run factory dialog from
    // appearing and lets the offline FX starters seed + hydrate.
    localStorage.setItem('nam-web-studio:factory-setup-dismissed', '1')
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
  const onboardingClose = page.getByRole('button', { name: "Let's go" })
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click()
  }

  await page.getByRole('button', { name: 'Power on' }).click()
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible({ timeout: 30000 })

  // Scene slot 1 ("Clean") is the factory default and loads a Compressor +
  // EQ (+ auto Mixer) into row 1, columns 1-3, on every fresh session (see
  // factoryScenes.ts). This test wants a genuinely empty grid to build its
  // own full chain on (and needs the Compressor/EQ kinds free of name
  // collisions for the bypass/enable/remove steps below), so it switches to
  // slot 8 ("Bypass") - the factory scene with an empty chain. Even an
  // "empty" chain still gets a merge Mixer (see buildFactoryPreset), so that
  // one block is removed before the grid is truly empty.
  await page.getByRole('button', { name: '8 Bypass' }).click()
  await page.getByRole('button', { name: 'Remove Mixer' }).click()
  await expect(page.getByRole('button', { name: /block - click or Enter to edit/ })).toHaveCount(0)

  // All 10 effect kinds: the four DSPark-backed ones (issue #22's last
  // migration - Gate, Compressor, EQ, Tremolo) plus six that already run on
  // packages/core.
  const FX_KINDS = [
    'Gate',
    'Compressor',
    'EQ',
    'Tremolo',
    'Reverb',
    'Chorus',
    'Flanger',
    'Phaser',
    'Delay',
    'Filter',
  ]

  // One block per column across the grid's 3 rows - well within GRID_ROWS x
  // GRID_COLS, and spread across rows so the semi-auto wiring (see
  // graphStore.ts) has to splice/anchor a mix of adjacent and orphaned cells.
  for (let i = 0; i < FX_KINDS.length; i++) {
    const row = (i % 3) + 1
    const col = Math.floor(i / 3) + 1
    await page
      .getByRole('button', { name: `Add a block at row ${row}, column ${col}`, exact: true })
      .click()
    await page.getByRole('menuitem', { name: FX_KINDS[i], exact: true }).click()
  }
  await page.getByRole('button', { name: 'Add a block at row 1, column 5', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mixer', exact: true }).click()

  for (const kind of FX_KINDS) {
    await page.getByRole('button', { name: `Bypass ${kind}`, exact: true }).click()
  }
  for (const kind of FX_KINDS) {
    await page.getByRole('button', { name: `Enable ${kind}`, exact: true }).click()
  }

  for (const kind of [...FX_KINDS, 'Mixer']) {
    await page.getByRole('button', { name: `Remove ${kind}`, exact: true }).click()
  }

  await expect(page.getByRole('button', { name: /block - click or Enter to edit/ })).toHaveCount(0)
  // The engine itself should have stayed up throughout - not just the grid emptying out.
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible()

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})
