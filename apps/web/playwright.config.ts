import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config (issue #11's "cross-browser testing matrix" + smoke tests).
 * Runs against a real Vite dev server so the audio engine's actual Web
 * Audio API is exercised - none of that is reachable from the jsdom-based
 * Vitest suite. Chromium runs with fake media devices so getUserMedia
 * resolves instead of prompting; Firefox/WebKit don't support that flag,
 * so those runs exercise the app's documented mic-denied fallback instead
 * of granting real audio input - both are real, valid app states.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
})
