import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// GitHub Pages serves project sites at /<repo>/ — keep base configurable so
// `pnpm dev` stays at `/` and CI builds emit /OpenAxe/ asset paths.
const base = process.env.GITHUB_ACTIONS ? '/OpenAxe/' : '/'
const dir = import.meta.dirname

export default defineConfig({
  base,
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(dir, 'index.html'),
        releases: resolve(dir, 'releases.html'),
      },
    },
  },
})
