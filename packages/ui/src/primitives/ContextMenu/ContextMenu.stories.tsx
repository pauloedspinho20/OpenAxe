import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { ContextMenu, type ContextMenuAnchor } from './ContextMenu'

const meta = {
  title: 'Primitives/ContextMenu',
  component: ContextMenu,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { onClose: () => {} },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

// Satisfies the required component props for render-driven stories - the
// actual rendered menu is driven by the RightClickArea state below.
const placeholderArgs = {
  open: false,
  anchor: { x: 0, y: 0 },
  items: [],
  onClose: () => {},
}

function RightClickArea({
  children,
}: {
  children: (anchor: ContextMenuAnchor | null) => React.ReactNode
}) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null)
  return (
    <div
      style={{
        width: 320,
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed var(--seam-strong)',
        borderRadius: 'var(--r-md)',
        color: 'var(--ink-3)',
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setAnchor({ x: e.clientX, y: e.clientY })
      }}
    >
      Right-click anywhere in here
      {children(anchor)}
    </div>
  )
}

export const BlockActions: Story = {
  args: placeholderArgs,
  render: () => (
    <RightClickArea>
      {(anchor) => (
        <ContextMenu
          open={anchor !== null}
          anchor={anchor}
          label="Block actions"
          onClose={() => {}}
          items={[
            { id: 'bypass', label: 'Bypass block', onSelect: () => {} },
            { id: 'disconnect', label: 'Disconnect all cables', onSelect: () => {} },
            { id: 'change', label: 'Change block type…', onSelect: () => {} },
            { id: 'remove', label: 'Remove block', danger: true, onSelect: () => {} },
          ]}
        />
      )}
    </RightClickArea>
  ),
}

export const DisabledAndDanger: Story = {
  args: placeholderArgs,
  render: () => (
    <RightClickArea>
      {(anchor) => (
        <ContextMenu
          open={anchor !== null}
          anchor={anchor}
          label="Knob MIDI"
          onClose={() => {}}
          items={[
            { id: 'learn', label: 'MIDI Learn…', onSelect: () => {} },
            {
              id: 'enable',
              label: 'MIDI Learn (enable MIDI first)',
              disabled: true,
              title: 'Enable MIDI in the MIDI manager before learning.',
              onSelect: () => {},
            },
            { id: 'clear', label: 'Clear mapping', danger: true, onSelect: () => {} },
          ]}
        />
      )}
    </RightClickArea>
  ),
}
