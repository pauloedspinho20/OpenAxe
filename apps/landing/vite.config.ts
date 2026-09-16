import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Root-relative base: the landing lives at the root of the site (Cloudflare
// Pages), not under /OpenAxe/ on GitHub Pages.
const base = '/'
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
      // Publish the release manifest the landing already renders as a static
      // JSON file, so the web app's update check can read it cross-origin
      // (Cloudflare Pages serves it with `access-control-allow-origin: *`).
      // The repo is private, so the web app can't use the unauthenticated
      // GitHub API. Emitted in addition to being bundled into the page.
      name: 'emit-releases-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'releases-data.json',
          source: readFileSync(resolve(dir, 'src/generated/releases.json'), 'utf8'),
        })
      },
    },
    {
      name: 'media-var-replace',
      transform(code, id) {
        if (id.endsWith('.css')) {
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
})
