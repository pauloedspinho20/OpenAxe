import type { Meta, StoryObj } from '@storybook/react'
import { Wordmark } from './Wordmark'

const meta = {
  title: 'Shared/Wordmark',
  component: Wordmark,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Wordmark>

export default meta
type Story = StoryObj<typeof meta>

export const Inline: Story = { args: { variant: 'inline' } }

export const Hero: Story = { args: { variant: 'hero' } }
