import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { findGridElement, isPointOverGrid, measureGridCell, resolveGridCell } from './gridGeometry'

function makeGridEl(rect: DOMRectInit): HTMLElement {
  const el = document.createElement('div')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
  return el
}

describe('gridGeometry', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('findGridElement', () => {
    it('returns null when no grid element exists', () => {
      expect(findGridElement()).toBeNull()
    })

    it('returns the element marked with data-grid-bounds', () => {
      const grid = document.createElement('div')
      grid.setAttribute('data-grid-bounds', '')
      document.body.appendChild(grid)
      expect(findGridElement()).toBe(grid)
    })
  })

  describe('resolveGridCell', () => {
    // 400x200 grid, 10 cols (40px each) x 4 rows (50px each).
    const rect = { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }

    it('maps an interior point to the correct cell', () => {
      const el = makeGridEl(rect)
      expect(resolveGridCell(el, 85, 60)).toEqual({ row: 1, col: 2 })
    })

    it('clamps points left/above the grid to the first cell', () => {
      const el = makeGridEl(rect)
      expect(resolveGridCell(el, -50, -50)).toEqual({ row: 0, col: 0 })
    })

    it('clamps points right/below the grid to the last cell', () => {
      const el = makeGridEl(rect)
      expect(resolveGridCell(el, 9999, 9999)).toEqual({ row: 3, col: 9 })
    })

    it('accounts for a non-zero grid origin', () => {
      const offset = { left: 100, top: 50, right: 500, bottom: 250, width: 400, height: 200 }
      const el = makeGridEl(offset)
      expect(resolveGridCell(el, 180, 150)).toEqual({ row: 2, col: 2 })
    })
  })

  describe('isPointOverGrid', () => {
    const rect = { left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }

    it('is true for a point inside the bounds', () => {
      const el = makeGridEl(rect)
      expect(isPointOverGrid(el, 200, 100)).toBe(true)
    })

    it('is false for a point outside the bounds', () => {
      const el = makeGridEl(rect)
      expect(isPointOverGrid(el, 500, 100)).toBe(false)
    })

    it('is false for a clamped-but-outside point', () => {
      const el = makeGridEl(rect)
      // resolveGridCell would clamp this, but isPointOverGrid should reject it.
      expect(isPointOverGrid(el, 350, -10)).toBe(false)
    })
  })

  describe('measureGridCell', () => {
    function mockComputed(style: Partial<CSSStyleDeclaration>): void {
      vi.spyOn(window, 'getComputedStyle').mockReturnValue(style as CSSStyleDeclaration)
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns the first column/row track size when px-sized', () => {
      const el = document.createElement('div')
      mockComputed({
        gridTemplateColumns: '80px 80px 80px 80px 80px 80px 80px 80px 80px 80px',
        gridTemplateRows: '80px 80px 80px 80px',
      })
      expect(measureGridCell(el)).toEqual({ w: 80, h: 80 })
    })

    it('returns null when tracks are not px-sized', () => {
      const el = document.createElement('div')
      mockComputed({ gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto' })
      expect(measureGridCell(el)).toBeNull()
    })

    it('returns null when the browser cannot compute tracks (jsdom)', () => {
      const el = document.createElement('div')
      mockComputed({ gridTemplateColumns: '', gridTemplateRows: '' })
      expect(measureGridCell(el)).toBeNull()
    })
  })
})
