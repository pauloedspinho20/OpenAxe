/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'media-var-replace',
      transform(code, id) {
        if (id.endsWith('.css')) {
          // Replace var(--mw-*) in @media conditions with actual px at build time
          // so browsers (which don't support var() in media queries) and
          // lightningcss (which errors on it) still work, while source keeps var().
          // Values must stay in sync with packages/ui/tokens/design-tokens.json
          // (regenerate via `node packages/ui/scripts/generate-tokens.mjs`).
          return code
            .replace(/var\(--mw-xxs\)/g, '320px')
            .replace(/var\(--mw-xs\)/g, '496px')
            .replace(/var\(--mw-sm\)/g, '640px')
            .replace(/var\(--mw-md\)/g, '720px')
            .replace(/var\(--mw-lg\)/g, '920px')
            .replace(/var\(--mw-xl\)/g, '1200px')
            .replace(/var\(--mw-xxl\)/g, '1600px')
        }
      },
    },
  ],
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
