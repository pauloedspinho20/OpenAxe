import { useEffect, useRef } from 'react'
import p5 from 'p5'
import { createArtDrawer, type ArtVariant, type DrawFn } from '../AudioArt/sketches'
import { readThemeColors } from './theme'
import styles from './AudioReactiveArt.module.css'

export interface AudioReactiveArtProps {
  /** The signal to react to - a block's own output tap, or the master/post-graph tap as the default. */
  analyser: AnalyserNode | null
  variant: ArtVariant
}

const EMPTY = new Uint8Array(0) as Uint8Array<ArrayBuffer>

/** False in jsdom (no `canvas` package installed) and any other environment without a real 2D context. */
function canvas2dSupported(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('2d'))
  } catch {
    return false
  }
}

/**
 * A p5.js instance-mode sketch mounted once per component lifetime (not
 * remounted on analyser/variant changes - both are read live via refs each
 * frame) so switching the selected block never flashes/recreates the
 * canvas. Reads CSS custom properties directly (see theme.ts) rather than
 * threading theme state through props, since there's no theme context or
 * change event to subscribe to (see useTheme.ts) - this stays correct
 * however the user last toggled it.
 */
export function AudioReactiveArt({ analyser, variant }: AudioReactiveArtProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const analyserRef = useRef(analyser)
  const variantRef = useRef(variant)
  analyserRef.current = analyser
  variantRef.current = variant

  useEffect(() => {
    const host = hostRef.current
    if (!host || !canvas2dSupported()) return

    // p5 v2's setup/draw lifecycle is async internally - under StrictMode's
    // dev-only double-invoke, a first effect run can still be mid-setup when
    // its cleanup fires, so `instance.remove()` alone can race and leave a
    // stray canvas behind. `disposed` is checked inside `setup` itself so an
    // instance that was torn down before it finished initializing removes
    // itself instead of ever creating a canvas.
    let disposed = false
    let ready = false

    const instance = new p5((p: p5) => {
      let timeBuffer: Uint8Array<ArrayBuffer> | null = null
      let freqBuffer: Uint8Array<ArrayBuffer> | null = null
      let colors = readThemeColors()
      let colorTick = 0
      let currentVariant: ArtVariant | null = null
      let drawer: DrawFn = createArtDrawer('master')
      let startMs = 0

      p.setup = () => {
        if (disposed) {
          p.remove()
          return
        }
        const rect = host.getBoundingClientRect()
        p.createCanvas(Math.max(1, rect.width), Math.max(1, rect.height))
        p.frameRate(45)
        startMs = p.millis()
        ready = true
      }

      p.draw = () => {
        if (disposed || !ready) return
        if (currentVariant !== variantRef.current) {
          currentVariant = variantRef.current
          drawer = createArtDrawer(currentVariant)
        }

        colorTick++
        if (colorTick % 30 === 0) colors = readThemeColors()

        const liveAnalyser = analyserRef.current
        let level = 0
        if (liveAnalyser) {
          if (!timeBuffer || timeBuffer.length !== liveAnalyser.fftSize) {
            timeBuffer = new Uint8Array(liveAnalyser.fftSize) as Uint8Array<ArrayBuffer>
            freqBuffer = new Uint8Array(liveAnalyser.frequencyBinCount) as Uint8Array<ArrayBuffer>
          }
          liveAnalyser.getByteTimeDomainData(timeBuffer)
          liveAnalyser.getByteFrequencyData(freqBuffer!)
          for (const v of timeBuffer) level = Math.max(level, Math.abs(v - 128) / 128)
        } else {
          timeBuffer = null
          freqBuffer = null
        }

        drawer(p, {
          level,
          waveform: timeBuffer ?? EMPTY,
          freq: freqBuffer ?? EMPTY,
          colors,
          t: (p.millis() - startMs) / 1000,
          width: p.width,
          height: p.height,
        })
      }
    }, host)

    const resizeObserver = new ResizeObserver(() => {
      if (!ready) return
      const rect = host.getBoundingClientRect()
      instance.resizeCanvas(Math.max(1, rect.width), Math.max(1, rect.height))
    })
    resizeObserver.observe(host)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      if (ready) instance.remove()
    }
  }, [])

  return <div ref={hostRef} className={styles.host} />
}
