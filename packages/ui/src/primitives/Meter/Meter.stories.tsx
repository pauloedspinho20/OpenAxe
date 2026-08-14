import type { Meta, StoryObj } from '@storybook/react'
import { Meter } from './Meter'

const meta = {
  title: 'Primitives/Meter',
  component: Meter,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    level: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof Meter>

export default meta
type Story = StoryObj<typeof meta>

export const Silence: Story = { args: { level: 0, label: 'MASTER' } }

export const Safe: Story = { args: { level: 0.5, label: 'CHAIN A' } }

export const Warning: Story = { args: { level: 0.85, label: 'CHAIN B' } }

export const Clipping: Story = { args: { level: 0.95, label: 'MASTER' } }
