/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs (real-browser tests, see playwright.config.ts) -
    // they match Vitest's default *.spec.ts glob too, but Playwright's `test` has a
    // different signature than Vitest's, so Vitest must never try to run them.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
})
