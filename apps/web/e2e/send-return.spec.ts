import { test, expect, type Page } from '@playwright/test'

/** wasm engine init + AudioWorklet registration - generous under parallel cross-browser load. */
const POWER_ON_TIMEOUT = 30000

async function powerOn(page: Page) {
  await page
    .getByRole('dialog', { name: 'Power on' })
    .getByRole('button', { name: 'Power on' })
    .click()
  await expect(page.getByRole('button', { name: 'Power off' })).toBeVisible({
    timeout: POWER_ON_TIMEOUT,
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Start from a clean slate (same rationale as core-flow.spec.ts).
  await page.evaluate(async () => {
    localStorage.clear()
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
})

/**
 * Send/Return relays (issue #274): place a Send 1 + Return 1 pair from the
 * Core group - both route through the rebuilt WASM core, which now knows
 * kinds 23-26 - and confirm the strictly-1:1 rule refuses a second Send 1.
 * The implicit Send->Return hop itself is verified by core's CTest suite;
 * this covers the real-browser placement + rejection path.
 */
test('places a Send/Return pair and enforces the strictly-1:1 rule', async ({ page }) => {
  await powerOn(page)

  // Factory scene slot 1 ("Clean") occupies row 1 columns 1-3; column 4+ is free.
  await page.getByRole('button', { name: 'Add a block at row 1, column 4' }).click()
  await page.getByRole('menuitem', { name: 'Send 1' }).click()
  await expect(
    page.getByRole('button', {
      name: 'Send 1 block - click or Enter to edit, arrow keys to move',
    }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Add a block at row 1, column 5' }).click()
  await page.getByRole('menuitem', { name: 'Return 1' }).click()
  await expect(
    page.getByRole('button', {
      name: 'Return 1 block - click or Enter to edit, arrow keys to move',
    }),
  ).toBeVisible()

  // Strictly 1:1 - a second Send 1 is refused with a toast rather than placed.
  await page.getByRole('button', { name: 'Add a block at row 2, column 4' }).click()
  await page.getByRole('menuitem', { name: 'Send 1' }).click()
  await expect(page.getByText('Send 1 is already on the grid')).toBeVisible()
})
