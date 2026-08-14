import type { Meta, StoryObj } from '@storybook/react'
import { Knob } from './Knob'

const meta = {
  title: 'Primitives/Knob',
  component: Knob,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
  args: { onChange: () => {} },
} satisfies Meta<typeof Knob>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { value: 0.5, label: 'GAIN' } }
export const MinValue: Story = { args: { value: 0, label: 'LEVEL' } }
export const MaxValue: Story = { args: { value: 1, label: 'DRIVE' } }
export const NoLabel: Story = { args: { value: 0.7, label: '' } }
