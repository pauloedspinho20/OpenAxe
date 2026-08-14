import type { Meta, StoryObj } from '@storybook/react'
import { Led } from './Led'

const meta = {
  title: 'Primitives/Led',
  component: Led,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Led>

export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { args: { label: 'STATUS' } }

export const OnGreen: Story = { args: { on: true, color: 'statusGreen', label: 'READY' } }

export const OnAmber: Story = { args: { on: true, color: 'statusAmber', label: 'WARN' } }

export const OnRed: Story = { args: { on: true, color: 'statusRed', label: 'ERROR' } }

export const OnAccent: Story = { args: { on: true, color: 'accent', label: 'ACTIVE' } }
