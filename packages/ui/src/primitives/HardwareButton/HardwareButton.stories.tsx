import type { Meta, StoryObj } from '@storybook/react'
import { HardwareButton } from './HardwareButton'

const meta = {
  title: 'Primitives/HardwareButton',
  component: HardwareButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { onClick: () => {} },
} satisfies Meta<typeof HardwareButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { label: 'POWER' } }

export const Active: Story = { args: { label: 'POWER', active: true } }

export const Disabled: Story = { args: { label: 'SAVE', disabled: true } }

export const Danger: Story = { args: { label: 'DELETE', variant: 'danger' } }

export const DangerActive: Story = { args: { label: 'DELETE', variant: 'danger', active: true } }
