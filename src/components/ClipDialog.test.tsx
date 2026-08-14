// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from '../state/graphStore'
import { useClipGuardStore } from '../state/clipGuardStore'
import { ClipDialog } from './ClipDialog'

describe('ClipDialog', () => {
  beforeEach(() => {
    useClipGuardStore.setState({ open: false })
    useGraphStore.setState({ clipMuted: false })
  })

  it('renders nothing until the guard trips', () => {
    const { container } = render(<ClipDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains the mute and un-mutes on dismiss', () => {
    useClipGuardStore.getState().trigger()
    render(<ClipDialog />)

    expect(screen.getByRole('dialog', { name: 'Output clipping' })).toBeInTheDocument()
    expect(useGraphStore.getState().clipMuted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useGraphStore.getState().clipMuted).toBe(false)
  })
})
