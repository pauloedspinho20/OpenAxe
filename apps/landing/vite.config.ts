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
  plugins: [
    {
      name: 'media-var-replace',
      transform(code, id) {
        if (id.endsWith('.css')) {
          return code
            .replace(/var\(--mw-xs\)/g, '520px')
            .replace(/var\(--mw-sm\)/g, '640px')
            .replace(/var\(--mw-md\)/g, '720px')
            .replace(/var\(--mw-lg\)/g, '920px')
            .replace(/var\(--mw-xl\)/g, '1200px')
            .replace(/var\(--mw-xxl\)/g, '1600px')
        }
      },
    },
  ],
})
