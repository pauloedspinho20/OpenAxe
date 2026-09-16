import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'

const meta = {
  title: 'Shared/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Live: Story = { args: { tone: 'live', children: 'Live' } }

export const Beta: Story = { args: { tone: 'beta', children: 'Beta' } }

export const Planned: Story = { args: { tone: 'planned', children: 'Planned' } }

export const Accent: Story = { args: { tone: 'accent', children: 'Latest' } }
