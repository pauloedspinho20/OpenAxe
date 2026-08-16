import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EdgeInstance } from '../../../state/graphStore'
import { jackElementId } from '../jackId'
import styles from './CableLayer.module.css'

interface Point {
  x: number
  y: number
}

export interface DragPreview {
  fromJackId: string
  clientX: number
  clientY: number
}

export interface CableLayerProps {
  edges: EdgeInstance[]
  /**
   * Any value that changes when block positions/count change (or a block is
   * being dragged, so its cables follow) - drives a recompute.
   */
  recomputeKey: unknown
  dragPreview: DragPreview | null
  /** Called when the user clicks one of the drawn cables to unhook it. */
  onDisconnect: (edgeId: string) => void
}

function cablePath(from: Point, to: Point): string {
  const dx = Math.max(24, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}

/**
 * Purely presentational SVG overlay: draws one bezier cable per store edge
 * plus a live preview while a new one is being dragged. Jack positions are
 * measured from the real DOM elements BlockCard/GridEditor render
 * (`data-jack-id`) - there's no separate coordinate model to keep in sync.
 * All pointer interaction (drag-to-connect) is owned by GridEditor, which is
 * the nearest common ancestor of both the jacks and this layer.
 */
export function CableLayer({ edges, recomputeKey, dragPreview, onDisconnect }: CableLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [paths, setPaths] = useState<Array<{ id: string; d: string }>>([])
  const [previewD, setPreviewD] = useState<string | null>(null)

  const pointFor = useCallback((elementId: string) => {
    const svg = svgRef.current
    const el = document.querySelector(`[data-jack-id="${elementId}"]`)
    if (!svg || !el) return null
    const containerRect = svg.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return {
      x: r.left + r.width / 2 - containerRect.left,
      y: r.top + r.height / 2 - containerRect.top,
    }
  }, [])

  const recompute = useCallback(() => {
    const next: Array<{ id: string; d: string }> = []
    for (const edge of edges) {
      const from = pointFor(jackElementId(edge.from.blockId, 'out', edge.from.port))
      const to = pointFor(jackElementId(edge.to.blockId, 'in', edge.to.port))
      if (from && to) next.push({ id: edge.id, d: cablePath(from, to) })
    }
    setPaths(next)
  }, [edges, pointFor])

  useLayoutEffect(() => {
    recompute()
  }, [recompute, recomputeKey])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg?.parentElement) return
    window.addEventListener('resize', recompute)
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', recompute)
    }
    const ro = new ResizeObserver(recompute)
    ro.observe(svg.parentElement)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [recompute])

  useLayoutEffect(() => {
    if (!dragPreview) {
      setPreviewD(null)
      return
    }
    const svg = svgRef.current
    const from = pointFor(dragPreview.fromJackId)
    if (!svg || !from) return
    const rect = svg.getBoundingClientRect()
    setPreviewD(
      cablePath(from, { x: dragPreview.clientX - rect.left, y: dragPreview.clientY - rect.top }),
    )
  }, [dragPreview, pointFor])

  return (
    <svg ref={svgRef} className={styles.svg} aria-hidden="true">
      {paths.map((p) => (
        <g key={p.id}>
          <path
            className={styles.cable}
            d={p.d}
            onClick={(e) => {
              e.stopPropagation()
              onDisconnect(p.id)
            }}
          />
        </g>
      ))}
      {previewD && <path className={styles.cablePreview} d={previewD} />}
    </svg>
  )
}
