import type { Meta, StoryObj } from '@storybook/react'
import { Card } from './Card'

const meta = {
  title: 'Shared/Card',
  component: Card,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'AMP — NAM captures',
    children: <p>Any .nam — amps, pedals, outboard. Same inference everywhere.</p>,
  },
}

export const Bare: Story = {
  args: {
    children: <p>Quick links live here.</p>,
  },
}
