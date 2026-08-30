/**
 * Blob <-> base64, shared by the export bundle and by the native asset store
 * (issue #300 follow-up).
 *
 * Chunked rather than `String.fromCharCode(...bytes)` in one go: a captured
 * amp model is megabytes, and spreading that many arguments overflows the
 * call stack.
 */

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
