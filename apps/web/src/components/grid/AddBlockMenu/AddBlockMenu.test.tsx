// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddBlockMenu } from './AddBlockMenu'
import { BLOCK_OPTIONS } from '../blockOptions'

describe('AddBlockMenu', () => {
  it('renders nothing when closed', () => {
    render(<AddBlockMenu open={false} onPick={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders a menuitem per block option when open', () => {
    render(<AddBlockMenu open onPick={() => {}} onClose={() => {}} />)
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(BLOCK_OPTIONS.length)
    expect(screen.getByText('Add a block')).toBeInTheDocument()
  })

  it('calls onPick with the chosen kind for an enabled option', () => {
    const onPick = vi.fn()
    render(<AddBlockMenu open onPick={onPick} onClose={() => {}} />)
    const amp = screen.getAllByRole('menuitem').find((b) => b.textContent?.includes('Amp'))!
    fireEvent.click(amp)
    expect(onPick).toHaveBeenCalledWith('amp')
  })

  it('does not call onPick for any currently-disabled option', () => {
    const onPick = vi.fn()
    const disabled = BLOCK_OPTIONS.filter((o) => o.disabled)
    if (disabled.length > 0) {
      render(<AddBlockMenu open onPick={onPick} onClose={() => {}} />)
      const btn = screen.getByRole('button', { name: disabled[0]!.label })
      expect(btn).toBeDisabled()
      fireEvent.click(btn)
      expect(onPick).not.toHaveBeenCalled()
    } else {
      // No options are disabled in the current BLOCK_OPTIONS list.
      expect(disabled).toHaveLength(0)
    }
  })

  it('calls onClose when the dialog overlay is clicked', () => {
    const onClose = vi.fn()
    render(<AddBlockMenu open onPick={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })
})
