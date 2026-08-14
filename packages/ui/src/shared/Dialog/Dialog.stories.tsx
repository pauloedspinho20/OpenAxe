import type { Meta, StoryObj } from '@storybook/react'
import { Dialog } from './Dialog'

const meta = {
  title: 'Shared/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    onClose: { action: 'closed' },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Small: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'INPUT',
    width: 'min(360px, 90vw)',
    children: <div style={{ color: 'var(--ink-3)' }}>Dialog content here.</div>,
  },
}

export const Medium: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'SETTINGS',
    width: 'min(520px, 90vw)',
    children: <div style={{ color: 'var(--ink-3)' }}>Settings content.</div>,
  },
}

export const Scrollable: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'LONG LIST',
    maxHeight: '300px',
    children: Array.from({ length: 20 }, (_, i) => (
      <div
        key={i}
        style={{ padding: '8px 0', color: 'var(--ink-2)', borderBottom: '1px solid var(--seam)' }}
      >
        Item {i + 1}
      </div>
    )),
  },
}
