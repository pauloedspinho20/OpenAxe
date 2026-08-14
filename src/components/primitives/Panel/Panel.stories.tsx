import type { Meta, StoryObj } from '@storybook/react'
import { Panel } from './Panel'

const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Panel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    label: 'AMP',
    children: <div style={{ padding: 16, color: 'var(--ink-3)' }}>Panel content</div>,
  },
}

export const Empty: Story = { args: { label: 'DELAY', children: null } }
