// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetViewHistoryForTests, useViewHistoryStore } from './state/viewHistoryStore'

describe('App', () => {
  beforeEach(() => {
    resetViewHistoryForTests()
  })

  afterEach(() => {
    resetViewHistoryForTests()
  })

  it('gates the app behind a power-on overlay, with the routing grid mounted underneath', () => {
    render(<App />)
    // Wordmark renders as <p>OPEN<span>AXE</span></p> — text is split across nodes,
    // so exact 'OPENAXE' string matcher fails; match the <p> specifically
    expect(
      screen.getAllByText((_, el) => el?.tagName === 'P' && el.textContent === 'OPENAXE').length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('dialog', { name: 'Power on' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'POWER ON' })).toBeInTheDocument()
    // The grid stays mounted (just visually covered) so it's ready the instant the gate clears.
    expect(screen.getByText('INPUT')).toBeInTheDocument()
    expect(screen.getByText('OUTPUT')).toBeInTheDocument()
  })

  it('switches between RIG and LEARN views via the shared header without a dialog wrapper', () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Views' })
    const rigBtn = screen.getByRole('button', { name: 'RIG' })
    const learnBtn = screen.getByRole('button', { name: 'LEARN' })
    expect(nav).toContainElement(rigBtn)
    expect(nav).toContainElement(learnBtn)
    expect(rigBtn).toHaveAttribute('aria-current', 'page')
    expect(learnBtn).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument()

    fireEvent.click(learnBtn)

    expect(learnBtn).toHaveAttribute('aria-current', 'page')
    expect(rigBtn).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Practice with backing tracks and tabs')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Media Center' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()

    const rigGridInput = screen.getByText('INPUT')
    const rigPane = rigGridInput.closest('[tabindex="-1"]')
    expect(rigPane).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(rigBtn)

    expect(rigBtn).toHaveAttribute('aria-current', 'page')
    expect(rigPane).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument()
    const learnPane = screen
      .getByText('Practice with backing tracks and tabs', {
        selector: 'h3',
      })
      .closest('[tabindex="-1"]')
    expect(learnPane).toHaveAttribute('aria-hidden', 'true')
  })

  it('routes shared header Undo/Redo buttons to the active view history controller', () => {
    render(<App />)
    const rigBtn = screen.getByRole('button', { name: 'RIG' })
    const learnBtn = screen.getByRole('button', { name: 'LEARN' })
    const undoBtn = screen.getByRole('button', { name: 'Undo' })
    const redoBtn = screen.getByRole('button', { name: 'Redo' })

    expect(undoBtn.getAttribute('title')).toMatch(/^Undo rig change \(/)
    expect(redoBtn.getAttribute('title')).toMatch(/^Redo rig change \(/)

    const learnUndo = vi.fn()
    const learnRedo = vi.fn()
    act(() => {
      useViewHistoryStore.getState().register('learn', {
        id: Symbol('learn-test'),
        label: 'tab edit',
        canUndo: true,
        canRedo: true,
        undo: learnUndo,
        redo: learnRedo,
      })
    })

    fireEvent.click(learnBtn)

    expect(undoBtn).toBeEnabled()
    expect(redoBtn).toBeEnabled()
    expect(undoBtn.getAttribute('title')).toMatch(/^Undo tab edit \(/)
    expect(redoBtn.getAttribute('title')).toMatch(/^Redo tab edit \(/)

    fireEvent.click(undoBtn)
    fireEvent.click(redoBtn)
    expect(learnUndo).toHaveBeenCalledOnce()
    expect(learnRedo).toHaveBeenCalledOnce()

    fireEvent.click(rigBtn)
    expect(undoBtn.getAttribute('title')).toMatch(/^Undo rig change \(/)
    fireEvent.click(undoBtn)
    expect(learnUndo).toHaveBeenCalledOnce()
  })
})
