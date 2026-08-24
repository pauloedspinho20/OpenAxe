import type { Meta, StoryObj } from '@storybook/react'
import { Wordmark } from './Wordmark'

const meta = {
  title: 'Shared/Wordmark',
  component: Wordmark,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    version: {
      control: 'text',
      description: 'Version string, e.g. "0.2.0" — normalised to "v0.2.0"',
    },
    showBeta: { control: 'boolean', description: 'Force BETA pill on/off (default: major === 0)' },
    variant: { control: 'select', options: ['inline', 'hero'] },
  },
} satisfies Meta<typeof Wordmark>

export default meta
type Story = StoryObj<typeof meta>

export const Inline: Story = { args: { variant: 'inline' } }

export const Hero: Story = { args: { variant: 'hero' } }

export const WithVersion: Story = { args: { variant: 'inline', version: '0.2.0' } }

export const WithBeta: Story = { args: { variant: 'inline', version: '0.2.0', showBeta: true } }

export const HeroWithVersion: Story = { args: { variant: 'hero', version: '0.2.0' } }

export const VersionOne: Story = {
  args: { variant: 'inline', version: '1.0.0' },
  parameters: {
    docs: { description: { story: 'BETA pill hidden when major >= 1 (auto-derived).' } },
  },
}
