// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CableLayer } from './CableLayer'
import type { EdgeInstance } from '../../../state/graphStore'

function rect(left: number, top: number, width = 8, height = 8) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => {},
  } as DOMRect
}

function jackEls() {
  const from = document.createElement('div')
  from.setAttribute('data-jack-id', 'a:out:0')
  const to = document.createElement('div')
  to.setAttribute('data-jack-id', 'b:in:0')
  document.body.append(from, to)
  return { from, to }
}

function stubRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this instanceof SVGSVGElement) return rect(0, 0, 400, 200)
    const id = (this as HTMLElement).getAttribute?.('data-jack-id')
    if (id === 'a:out:0') return rect(10, 10)
    if (id === 'b:in:0') return rect(300, 10)
    return rect(0, 0, 0, 0)
  })
}

const edge: EdgeInstance = {
  id: 'e1',
  from: { blockId: 'a', port: 0 },
  to: { blockId: 'b', port: 0 },
}

describe('components/CableLayer', () => {
  beforeEach(() => {
    stubRects()
    // Jack elements must exist in the document before render so the layer can
    // measure them during its initial layout effect.
    jackEls()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('draws one cable path per edge that has both jacks in the DOM', () => {
    const { container } = render(
      <CableLayer edges={[edge]} recomputeKey={0} dragPreview={null} onDisconnect={vi.fn()} />,
    )
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0]!.getAttribute('d')).toMatch(/^M /)
  })

  it('calls onDisconnect when a drawn cable is clicked', () => {
    const onDisconnect = vi.fn()
    const { container } = render(
      <CableLayer edges={[edge]} recomputeKey={0} dragPreview={null} onDisconnect={onDisconnect} />,
    )
    fireEvent.click(container.querySelector('path')!)
    expect(onDisconnect).toHaveBeenCalledWith('e1')
  })

  it('renders a preview cable while a connection is being dragged', () => {
    const { container } = render(
      <CableLayer
        edges={[]}
        recomputeKey={0}
        dragPreview={{ fromJackId: 'a:out:0', clientX: 100, clientY: 100 }}
        onDisconnect={vi.fn()}
      />,
    )
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0]!.getAttribute('d')).toMatch(/^M /)
  })
})
