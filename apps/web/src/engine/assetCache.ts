/**
 * Blob cache for downloaded .nam models and IR files, so they're available
 * offline after the first fetch (see the Offline/PWA epic) without
 * re-downloading from Tone3000 every session.
 *
 * Two backends, same as storage/kv.ts. On the web this is IndexedDB. In the
 * desktop shell and inside a plugin it is a directory on disk shared by both,
 * because the webview's own storage is scoped to an origin that changes every
 * launch *and* to the host application - which is why the factory pack looked
 * like it needed reinstalling every time the app was opened (issue #300).
 *
 * Reads in a native shell go over HTTP rather than through the bridge. The
 * loopback server that already serves the UI also serves `/__asset/<id>`, so
 * the webview streams the bytes straight into a Blob; sending them through
 * the bridge instead would mean base64, a third more bytes, and one enormous
 * string per capture. The bridge is still the fallback for when there is no
 * such server - running the shell against a Vite dev server via
 * OPENAXE_UI_URL, where the page's origin is Vite and knows no such route.
 */
import { getOpenAxe } from '../native/openaxe'
import { STORE_ASSETS } from '../storage/db'
import { base64ToBlob, blobToBase64 } from '../storage/base64'
import { kvClear, kvDelete, kvGet, kvGetAll, kvGetAllKeys, kvPut } from '../storage/kv'

/** Read a cached asset by id, or null if it isn't cached. */
export async function getCachedAsset(id: string): Promise<Blob | null> {
  const native = getOpenAxe()
  if (native) {
    try {
      const response = await fetch(`/__asset/${encodeURIComponent(id)}`)
      if (response.ok) return await response.blob()
      // A 404 is a genuine cache miss; anything else falls through to the
      // bridge rather than being reported as "not cached".
      if (response.status === 404) return null
    } catch {
      // No loopback server (dev-server mode) - use the bridge below.
    }
    const result = await native.assetGet({ key: id })
    if (!result.base64) return null
    return base64ToBlob(result.base64, result.type ?? 'application/octet-stream')
  }
  const result = await kvGet<Blob>(STORE_ASSETS, id)
  return result ?? null
}

/** True when the asset is cached, without reading its bytes. */
export async function hasCachedAsset(id: string): Promise<boolean> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.assetHas({ key: id })
    return result.present
  }
  return (await kvGet<Blob>(STORE_ASSETS, id)) !== undefined
}

/** Store (or overwrite) an asset blob under id. */
export async function putCachedAsset(id: string, blob: Blob): Promise<void> {
  const native = getOpenAxe()
  if (native) {
    await native.assetPut({
      key: id,
      base64: await blobToBase64(blob),
      type: blob.type || 'application/octet-stream',
    })
    return
  }
  await kvPut(STORE_ASSETS, blob, id)
}

/** Remove a cached asset. */
export async function deleteCachedAsset(id: string): Promise<void> {
  const native = getOpenAxe()
  if (native) {
    await native.assetDelete({ key: id })
    return
  }
  await kvDelete(STORE_ASSETS, id)
}

/** Count and total bytes of everything cached, for the Settings dialog. */
export async function getCachedAssetStats(): Promise<{ count: number; bytes: number }> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.assetStats()
    return { count: result.count, bytes: result.bytes }
  }
  const blobs = await kvGetAll<Blob>(STORE_ASSETS)
  return { count: blobs.length, bytes: blobs.reduce((sum, blob) => sum + blob.size, 0) }
}

/** Remove every cached asset. */
export async function clearCachedAssets(): Promise<void> {
  const native = getOpenAxe()
  if (native) {
    await native.assetClear()
    return
  }
  await kvClear(STORE_ASSETS)
}

/** Every cached asset id. */
export async function listCachedAssetIds(): Promise<string[]> {
  const native = getOpenAxe()
  if (native) {
    const result = await native.assetKeys()
    return result.keys
  }
  return kvGetAllKeys(STORE_ASSETS)
}

/**
 * Fetch an asset from the network, caching it under `id` for next time.
 * Returns the cached copy immediately if present (no network request).
 */
export async function fetchWithCache(id: string, url: string): Promise<Blob> {
  const cached = await getCachedAsset(id)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch asset '${id}' from ${url}: ${response.status}`)
  }
  const blob = await response.blob()
  await putCachedAsset(id, blob)
  return blob
}
