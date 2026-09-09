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
  // Scene applies are async end to end and only *start* once the engine is
  // ready: useSceneEngine fires reloadActive when status becomes 'ready'
  // (== the "Power off" button flips visible), then applyPreset reads the
  // preset from IndexedDB, tears down + rebuilds the worklet, and loadGraph
  // renders the blocks. Under the parallel matrix this routinely exceeds a
  // 30s wait on a loaded machine (flaked on run 38550000042 and the same
  // count assertion), so the initial load and the slot switch below get the
  // same generous budget the rest of this heavy test already runs under.
  const SCENE_LOAD_TIMEOUT = 90_000
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // Hermetic update check (see src/hooks/useUpdateCheck.ts): the hook fetches
  // api.github.com + the landing fallback on every fresh load. In CI the API
  // has no releases (404) and the fallback is CORS-blocked, and browsers log
  // failed fetches as console errors no matter how carefully the hook catches
  // them — which trips the zero-console-error assertion below. Fulfill with a
  // tag older than the app version so the hook resolves to "no update" and
  // never attempts the fallback.
  await page.route(
    'https://api.github.com/repos/pauloedspinho20/OpenAxe/releases/latest',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tag_name: 'v0.0.0',
          html_url: 'https://github.com/pauloedspinho20/OpenAxe/releases/tag/v0.0.0',
          published_at: null,
        }),
      }),
  )
  // Belt-and-braces: if the primary mock ever misses (or the API path
  // changes), the hook falls through to the landing fallback
  // (useUpdateCheck.ts), which in CI 403s / is CORS-blocked from localhost
  // and trips the same zero-console-error assertion (run 33829263762).
  // Fulfill it hermetically too so no real network can leak console errors.
  await page.route('https://pauloedspinho20.github.io/OpenAxe/releases-data.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ releases: [] }),
    }),
  )

  await page.goto('/')
  // Start from a clean slate: the grid/presets persist to IndexedDB (see
  // src/storage/db.ts), so a prior test run's saved blocks/presets would
  // otherwise still be there on this load.
  await page.evaluate(async () => {
    localStorage.clear()
    // Established-session marker: keeps the first-run factory dialog from
    // appearing and lets the offline FX starters seed + hydrate.
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
  //
  // Wait for the switch to actually land before removing anything. Slot
  // switching is async end to end - sceneNavigator.applySlot awaits the
  // IndexedDB preset read and then applyPreset's worklet teardown/rebuild,
  // and the grid only re-renders on that final loadGraph. Clicking straight
  // through leaves a window where the DOM still shows Clean's three blocks,
  // so "Remove Mixer" removes *Clean's* Mixer and scene 8's own Mixer then
  // arrives into a grid this test believes it just emptied - which is how
  // this flaked on CI (run 33339848912: count went 2, then 1, never 0).
  // Counts are unambiguous here because applyPreset calls loadGraph exactly
  // once, after the rebuild: 3 is Clean, 1 is scene 8, there is no
  // intermediate state to race against.
  const blocks = page.getByRole('button', { name: /block - click or Enter to edit/ })
  await expect(blocks).toHaveCount(3, { timeout: SCENE_LOAD_TIMEOUT })
  await page.getByRole('button', { name: '8 Bypass' }).click()
  await expect(blocks).toHaveCount(1, { timeout: SCENE_LOAD_TIMEOUT })
  // Mixer removal now lives in the block's actions sheet (⋯ menu) — the direct
  // Remove button was moved from BlockCard to BlockActionSheet for mobile.
  await page.getByRole('button', { name: 'Actions for Mixer' }).click()
  await page.getByRole('button', { name: 'Remove block' }).click()
  await expect(blocks).toHaveCount(0)

  // All 10 compiled effect kinds (effects.config.json #313): the four
  // DSPark-backed ones (issue #22's last migration - Gate, Compressor, EQ,
  // Tremolo) plus six that already run on packages/core. Filter/ring-mod/
  // granular-delay/pitch-shifter are compiled out, so they must not appear
  // here - the palette (PALETTE_BLOCK_KINDS) won't offer them and the
  // menuitem lookup would time out.
  const FX_KINDS = [
    'Gate',
    'Comp',
    'EQ',
    'Tremolo',
    'Reverb',
    'Chorus',
    'Flanger',
    'Phaser',
    'Delay',
    'Rotary',
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
    await page.getByRole('button', { name: `Actions for ${kind}` }).click()
    await page.getByRole('button', { name: 'Remove block' }).click()
  }

  await expect(page.getByRole('button', { name: /block - click or Enter to edit/ })).toHaveCount(0)
  // The engine itself should have stayed up throughout - not just the grid emptying out.
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible()

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})
