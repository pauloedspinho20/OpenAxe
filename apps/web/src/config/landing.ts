/**
 * Landing (marketing/download) site URL, used for the in-app download links
 * and for the release manifest the update check reads.
 *
 * Configurable per deployment via `VITE_LANDING_URL` (see `.env.example`);
 * defaults to the production landing. Trailing slashes are stripped so the
 * derived URLs below stay single-slashed.
 */
export const LANDING_URL = (
  (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim() ||
  'https://openaxe-site.pages.dev'
).replace(/\/+$/, '')

/** Landing downloads section — the update banner's "Download" link. */
export const LANDING_DOWNLOAD_URL = `${LANDING_URL}/#download`

/** Landing's full releases archive page. */
export const LANDING_RELEASES_URL = `${LANDING_URL}/releases.html`

/**
 * Release manifest emitted by the landing build (see
 * apps/landing/vite.config.ts) and served with `access-control-allow-origin: *`.
 */
export const RELEASES_MANIFEST_URL = `${LANDING_URL}/releases-data.json`
