import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from './playerStore'
import { getSongBytes } from './songsStore'
import styles from './SheetViewer.module.css'

export function SheetViewer() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const positionTicks = usePlayerStore((s) => s.positionTicks)
  const trackMutes = usePlayerStore((s) => s.trackMutes)
  const toggleTrackMute = usePlayerStore((s) => s.toggleTrackMute)
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [layout, setLayout] = useState<'page' | 'horizontal'>('page')

  // AlphaTab rendering (when available)
  useEffect(() => {
    if (!currentSong || !containerRef.current) return
    let cancelled = false

    const render = async () => {
      const el = containerRef.current
      if (!el) return
      el.innerHTML = ''

      // Try to use alphaTab if installed
      try {
        const mod = await import('@coderline/alphatab').catch(() => null)
        if (!mod || cancelled) throw new Error('no alphaTab')
        const api = new (mod as unknown as { AlphaTabApi: new (el: HTMLElement, opts: unknown) => { render: () => void; load: (data: Uint8Array) => void; tex: (t: string) => void } }).AlphaTabApi(el, {
          core: { fontDirectory: '/font/' },
          display: { layoutMode: layout === 'page' ? 0 : 1, scale: zoom / 100 },
          player: { enablePlayer: false },
        })
        const bytes = getSongBytes(currentSong)
        // AlphaTab can load GP/MusicXML/MIDI bytes directly
        ;(api as unknown as { load: (b: Uint8Array) => void }).load(bytes)
        ;(api as unknown as { render: () => void }).render()
        return
      } catch {
        // Fallback: simple placeholder
        if (cancelled || !el) return
        el.innerHTML = `<div style="padding:24px;color:var(--ink-2);font-family:var(--font-display);font-size:13px;">
          <div style="font-weight:600;">${currentSong.title}</div>
          <div>${currentSong.barCount} bars · ${currentSong.tracks.length} tracks · ${currentSong.tempoMap[0]?.bpm ?? 120} BPM</div>
          <div style="margin-top:12px;color:var(--ink-3);">Score rendering requires @coderline/alphatab — showing placeholder.</div>
        </div>`
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [currentSong, zoom, layout])

  // Cursor sync: highlight current bar based on positionTicks
  const currentBar = currentSong ? Math.floor(positionTicks / (currentSong.ticksPerBeat * 4)) + 1 : 0

  if (!currentSong) {
    return (
      <div className={styles.viewer} role="region" aria-label="Sheet viewer">
        <p className={styles.hint}>Select a song to view its score</p>
      </div>
    )
  }

  return (
    <div className={styles.viewer} role="region" aria-label="Sheet viewer">
      <div className={styles.toolbar}>
        <div className={styles.trackList}>
          {currentSong.tracks.map((track) => (
            <label key={track.id} className={styles.trackRow}>
              <input type="checkbox" checked={!trackMutes[track.id]} onChange={() => toggleTrackMute(track.id)} aria-label={`Track ${track.name}`} />
              <span>{track.name}</span>
              <span className={styles.trackMeta}>
                {track.instrument} · ch {track.channel + 1}
              </span>
            </label>
          ))}
        </div>
        <div className={styles.zoomRow}>
          <button type="button" className={styles.zoomBtn} onClick={() => setZoom((z) => Math.max(50, z - 10))} aria-label="Zoom out">
            −
          </button>
          <span className={styles.zoomLabel}>{zoom}%</span>
          <button type="button" className={styles.zoomBtn} onClick={() => setZoom((z) => Math.min(200, z + 10))} aria-label="Zoom in">
            +
          </button>
          <select value={layout} onChange={(e) => setLayout(e.target.value as 'page' | 'horizontal')} className={styles.layoutSelect} aria-label="Layout">
            <option value="page">Page</option>
            <option value="horizontal">Horizontal</option>
          </select>
        </div>
      </div>

      <div className={styles.cursorInfo} aria-live="polite">
        Bar {currentBar} / {currentSong.barCount} · Tick {positionTicks}
      </div>

      <div ref={containerRef} className={styles.scoreContainer} />
    </div>
  )
}
