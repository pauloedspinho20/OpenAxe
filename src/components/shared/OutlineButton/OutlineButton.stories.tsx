import type { Meta, StoryObj } from '@storybook/react'
import { OutlineButton } from './OutlineButton'

const meta = {
  title: 'Shared/OutlineButton',
  component: OutlineButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    onClick: { action: 'clicked' },
  },
} satisfies Meta<typeof OutlineButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: 'IMPORT' } }

export const Danger: Story = { args: { children: 'REMOVE', variant: 'danger' } }
