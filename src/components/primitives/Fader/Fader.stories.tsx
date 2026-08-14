import type { Meta, StoryObj } from '@storybook/react'
import { Fader } from './Fader'

const meta = {
  title: 'Primitives/Fader',
  component: Fader,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
  args: { onChange: () => {} },
} satisfies Meta<typeof Fader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { value: 0.6, label: 'VOL' } }

export const Zero: Story = { args: { value: 0, label: 'MIX' } }

export const Full: Story = { args: { value: 1, label: 'OUT' } }
