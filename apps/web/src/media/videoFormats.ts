/**
 * Video sizes and recordable containers shared by the tab video export
 * (tabs/videoExport.ts) and the VISUALS recorder. Kept free of alphaTab so
 * importing it does not pull the score renderer into other bundles.
 */
export interface VideoSize {
  id: string
  label: string
  width: number
  height: number
}

export const VIDEO_SIZES: VideoSize[] = [
  { id: '1080p', label: '1920×1080 (HD landscape)', width: 1920, height: 1080 },
  { id: '720p', label: '1280×720 (720p landscape)', width: 1280, height: 720 },
  { id: '4k', label: '3840×2160 (4K landscape)', width: 3840, height: 2160 },
  { id: 'vertical', label: '1080×1920 (vertical: Shorts / Reels)', width: 1080, height: 1920 },
  { id: 'square', label: '1080×1080 (square)', width: 1080, height: 1080 },
]

/** The best container this browser can record, or null. */
export function pickMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const options: { mime: string; ext: 'mp4' | 'webm' }[] = [
    { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ]
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null
}
