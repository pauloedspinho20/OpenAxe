import type { Meta, StoryObj } from '@storybook/react'
import { HardwareButton } from './HardwareButton'
import { MidiIcon, PowerIcon, SettingsIcon } from '../../icons'

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

export const WithIcon: Story = {
  args: { label: 'SETTINGS', icon: <SettingsIcon size={16} />, onClick: () => {} },
}

export const IconOnly: Story = {
  args: { label: 'Settings', icon: <SettingsIcon size={16} />, iconOnly: true, onClick: () => {} },
}

export const IconOnlyActive: Story = {
  args: {
    label: 'MIDI',
    icon: <MidiIcon size={16} />,
    iconOnly: true,
    active: true,
    onClick: () => {},
  },
}

export const PowerIconOnly: Story = {
  args: { label: 'Power off', icon: <PowerIcon size={16} />, iconOnly: true, onClick: () => {} },
}
