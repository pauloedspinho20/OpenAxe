import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta = {
  title: 'Shared/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    onClick: { action: 'clicked' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { children: 'Open web app — no install' } }

export const Ghost: Story = { args: { variant: 'ghost', children: 'Download desktop' } }

export const Small: Story = { args: { variant: 'ghost', size: 'sm', children: 'Carbon' } }

export const AsLink: Story = {
  args: { href: 'https://openaxe.pages.dev', children: 'Open web app ↗' },
}
