/**
 * Tone3000 environment configuration. The publishable key is safe for a
 * client-side SPA and is used as the OAuth `client_id`; the `t3k_cs_` secret
 * key is server-only per Tone3000's docs and is deliberately never included
 * in this app (a client-only bundle can't keep a secret secret).
 *
 * Config lives in VITE_ env vars; at runtime the Tone3000 feature is hidden
 * (no-op) until a publishable key + redirect URI are configured. See
 * .env.example for the expected shape.
 */

/** API base URL with trailing slashes stripped (see the reference client's config). */
export const T3K_API = (
  (import.meta.env.VITE_T3K_API_DOMAIN as string | undefined) ?? 'https://www.tone3000.com'
).replace(/\/+$/, '')

/** Publishable key (t3k_pub_...), also the OAuth client_id. Optional - gate on it. */
export const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLISHABLE_KEY as string | undefined

/** Registered redirect URI for the OAuth callback. */
export const REDIRECT_URI =
  (import.meta.env.VITE_REDIRECT_URI as string | undefined) ?? 'http://localhost:5173'

/** True once the app has enough config to show the Tone3000 catalog. */
export const isTone3000Configured = (): boolean =>
  Boolean(PUBLISHABLE_KEY && REDIRECT_URI && navigator.onLine)
