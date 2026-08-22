/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/*.stories.*', '**/.claude/**'],
    coverage: {
      provider: 'v8',
      // The committed WASM glue in public/wasm-core is generated, not
      // hand-written source, so it's excluded from the regression gate.
      exclude: [
        '**/node_modules/**',
        '**/e2e/**',
        '**/*.stories.*',
        '**/.claude/**',
        'public/wasm-core/**',
      ],
      // Regression gate (issue #141): fail the local coverage run if apps/web
      // drops below these. Set a hair below the measured baseline so a single
      // flaky test can't trip it, while real coverage losses do.
      thresholds: {
        statements: 72,
        branches: 60,
        functions: 67,
        lines: 73,
      },
    },
  },
})
